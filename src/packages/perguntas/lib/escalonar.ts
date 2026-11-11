import { addBusinessHours, workdayHours } from "../../../business-hours.js";
import type { QuestionRef } from "../../../channel.js";
import type { BusinessCalendar } from "../../../config.js";
import { HORAS_ATE_LEMBRETE } from "./criar.js";
import { textoDoLembrete } from "./lembrete.js";

/** Pergunta como o escalonamento a enxerga: os prazos, os sinais de lembrete e de aviso, e o que ela já sabe. */
export interface PerguntaEscalonavel {
  n: number;
  origin: "grill" | "card-raso" | "tecnica";
  to: string;
  text: string;
  ref: QuestionRef;
  remindAt: number;
  notifyAt: number;
  reminded: boolean;
  notified: boolean;
  answer: string | null;
  publication?: "draft" | "sending" | "sent";
  reminder?: string;
  forwarding?: unknown;
}

/** Evento de escalonamento: aviso ao usuário ou pergunta lembrada ou encaminhada. */
export type EventoEscalonamento =
  | { type: "notify"; project: string; target: string; reason: "pergunta-sem-resposta"; message: string }
  | {
      type: "question";
      project: string;
      target: string;
      n: number;
      to: string;
      text: string;
      status: "lembrete" | "escalonada";
    };

/** Tarefa e projeto da pergunta escalonada. */
export interface AlvoEscalonamento {
  id: string;
  projeto: string;
  chave: string;
}

/** Dependências do escalonamento. */
export interface PortasEscalonamento {
  agora(): number;
  /** Próximo instante em que o projeto está em atividade (o próprio `agora` quando não há expediente a respeitar). */
  proximaAtividade(projeto: string, agora: number): number;
  /** Pergunta que a Tarefa aguarda, como cópia; `undefined` se não aguarda nenhuma. */
  pendente(tarefaId: string): Promise<PerguntaEscalonavel | undefined>;
  /** Altera a pergunta na Tarefa numa transação durável. */
  alterarPergunta(tarefaId: string, n: number, mudar: (pergunta: PerguntaEscalonavel) => void): Promise<void>;
  /** Confere a resposta pelo Canal; `true` se ela chegou (e foi registrada). */
  conferir(tarefaId: string, n: number): Promise<boolean>;
  /** Leva uma pergunta técnica ao responsável técnico. */
  encaminharTecnica(tarefaId: string, n: number): Promise<void>;
  /** Manda o lembrete pelo Canal. */
  lembrar(ref: QuestionRef, texto: string): Promise<void>;
  /** Faz uma pergunta nova pelo Canal (escalonamento à pessoa seguinte). */
  perguntarNoCanal(entrada: { card: string; to: string; text: string }): Promise<QuestionRef>;
  /** Próxima pessoa do perfil PO depois da atual, se houver. */
  proximaPO(projeto: string, idAtual: string): { id: string; name?: string } | undefined;
  /** Configuração do projeto que o escalonamento lê. */
  configuracao(projeto: string): { questionApproval: boolean; calendario: BusinessCalendar };
  registrarEvento(evento: EventoEscalonamento): Promise<void>;
}

/** Espera antes de reavaliar uma pergunta que ainda é rascunho ou está sendo enviada. */
const ESPERA_RASCUNHO_MS = 60_000;

/**
 * Escalonamento de uma pergunta sem resposta. Pergunta técnica: encaminha ao responsável técnico. Pergunta do PO: lembra
 * em horas úteis (com revisão, o lembrete vira rascunho); sem resposta no prazo, escalona à pessoa seguinte do perfil PO
 * (com revisão, a troca vira rascunho); e, um dia útil depois, avisa o usuário. Devolve quando acordar de novo, ou `null`
 * se não há mais o que esperar.
 */
export async function escalonarPergunta(portas: PortasEscalonamento, alvo: AlvoEscalonamento): Promise<number | null> {
  // Fora do expediente, a pergunta espera o próximo instante de atividade do projeto.
  const proxima = portas.proximaAtividade(alvo.projeto, portas.agora());
  if (proxima > portas.agora()) return proxima;
  const q = await portas.pendente(alvo.id);
  if (!q) return null;
  // As perguntas técnicas são respondidas localmente, não pelo comentário no card. O encaminhamento ao tech lead é do
  // fluxo técnico, não do lembrete ao PO.
  if (q.origin === "tecnica") return escalonarTecnica(portas, alvo, q);
  if (q.publication === "draft" || q.publication === "sending") return portas.agora() + ESPERA_RASCUNHO_MS;
  if (await portas.conferir(alvo.id, q.n)) return null;

  const config = portas.configuracao(alvo.projeto);
  const agora = portas.agora();
  await lembrarSePreciso(portas, alvo, q, config.questionApproval, agora);

  // Pergunta de negócio sem resposta no prazo escalona à pessoa seguinte do perfil PO. Com revisão de perguntas, o
  // escalonamento vira rascunho: só sai no card depois da aprovação, como a pergunta original.
  const seguinte = !q.notified && agora >= q.notifyAt ? portas.proximaPO(alvo.projeto, q.to) : undefined;
  if (seguinte)
    return escalonarParaPessoaSeguinte(portas, alvo, q, seguinte, config.questionApproval, config.calendario, agora);

  if (!q.notified && agora >= q.notifyAt) {
    await portas.registrarEvento({
      type: "notify",
      project: alvo.projeto,
      target: alvo.chave,
      reason: "pergunta-sem-resposta",
      message: `A pergunta ${q.n} ao PO no card ${alvo.chave} está há 1 dia útil sem resposta: ${q.text}`,
    });
    await portas.alterarPergunta(alvo.id, q.n, (stored) => {
      stored.notified = true;
    });
    q.notified = true;
  }
  const proximos = [!q.reminded ? q.remindAt : null, !q.notified ? q.notifyAt : null].filter((t) => t !== null);
  return proximos.length > 0 ? Math.min(...proximos) : null;
}

/** Pergunta técnica: encaminha ao responsável técnico e acorda no prazo de lembrete, se ainda não foi encaminhada. */
async function escalonarTecnica(
  portas: PortasEscalonamento,
  alvo: AlvoEscalonamento,
  q: PerguntaEscalonavel,
): Promise<number | null> {
  await portas.encaminharTecnica(alvo.id, q.n);
  return !q.forwarding && portas.agora() < q.remindAt ? q.remindAt : null;
}

/**
 * Lembrete ao PO no prazo. Com revisão de perguntas, não sai sozinho: vira rascunho e o usuário o aprova pela página.
 * Sem revisão, sai pelo canal. Em qualquer dos dois casos, a pergunta fica marcada como lembrada.
 */
async function lembrarSePreciso(
  portas: PortasEscalonamento,
  alvo: AlvoEscalonamento,
  q: PerguntaEscalonavel,
  revisao: boolean,
  agora: number,
): Promise<void> {
  if (!q.reminded && agora >= q.remindAt && revisao) {
    await portas.alterarPergunta(alvo.id, q.n, (stored) => {
      stored.reminded = true;
      stored.reminder ??= "draft";
    });
    await portas.registrarEvento({
      type: "notify",
      project: alvo.projeto,
      target: alvo.chave,
      reason: "pergunta-sem-resposta",
      message: `O lembrete da pergunta ${q.n} no card ${alvo.chave} aguarda a sua revisão antes de ser publicado.`,
    });
    q.reminded = true;
  }
  if (!q.reminded && agora >= q.remindAt) {
    await portas.lembrar(q.ref, textoDoLembrete(q));
    await portas.alterarPergunta(alvo.id, q.n, (stored) => {
      stored.reminded = true;
    });
    await portas.registrarEvento({
      type: "question",
      project: alvo.projeto,
      target: alvo.chave,
      n: q.n,
      to: q.to,
      text: q.text,
      status: "lembrete",
    });
    q.reminded = true;
  }
}

/**
 * Encaminha a pergunta à pessoa seguinte do perfil PO. Com revisão, a troca vira rascunho e o aviso vai ao usuário; sem
 * revisão, a pergunta sai no canal para a nova pessoa. Acorda de novo depois de um prazo útil de lembrete.
 */
async function escalonarParaPessoaSeguinte(
  portas: PortasEscalonamento,
  alvo: AlvoEscalonamento,
  q: PerguntaEscalonavel,
  seguinte: { id: string; name?: string },
  revisao: boolean,
  calendario: BusinessCalendar,
  agora: number,
): Promise<number> {
  const ref = revisao
    ? { card: alvo.chave, to: seguinte.id, before: [] }
    : await portas.perguntarNoCanal({
        card: alvo.chave,
        to: seguinte.id,
        // O texto nomeia a pessoa: sem isso, a deduplicação do escritor trataria a repetição como a mesma mensagem.
        text: `Pergunta ${q.n} (encaminhada a ${seguinte.name ?? seguinte.id}): ${q.text}`,
      });
  await portas.alterarPergunta(alvo.id, q.n, (stored) => {
    stored.to = seguinte.id;
    stored.ref = ref;
    stored.reminded = false;
    stored.notified = false;
    if (revisao) stored.publication = "draft";
    stored.remindAt = addBusinessHours(calendario, agora, HORAS_ATE_LEMBRETE);
    stored.notifyAt = addBusinessHours(calendario, agora, workdayHours(calendario));
  });
  await portas.registrarEvento(
    revisao
      ? {
          type: "notify",
          project: alvo.projeto,
          target: alvo.chave,
          reason: "pergunta-sem-resposta",
          message: `A pergunta ${q.n} no card ${alvo.chave} foi encaminhada a ${seguinte.name ?? seguinte.id} e aguarda a sua revisão.`,
        }
      : {
          type: "question",
          project: alvo.projeto,
          target: alvo.chave,
          n: q.n,
          to: seguinte.id,
          text: q.text,
          status: "escalonada",
        },
  );
  return addBusinessHours(calendario, agora, HORAS_ATE_LEMBRETE);
}
