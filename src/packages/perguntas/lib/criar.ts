import { addBusinessHours, workdayHours } from "../../../business-hours.js";
import type { QuestionRef } from "../../../channel.js";
import type { BusinessCalendar } from "../../../config.js";

/** Horas úteis sem resposta até o lembrete à pessoa perguntada. */
export const HORAS_ATE_LEMBRETE = 4;

/** Quantas perguntas uma Tarefa pode levar ao PO antes de a SPEC parar e pedir a decisão do usuário. */
export const MAX_PERGUNTAS_PO = 5;

/** Origem da pergunta: o grill, o card raso, ou uma decisão técnica do repositório. */
export type OrigemPergunta = "grill" | "card-raso" | "tecnica";

/** Pergunta como a Tarefa a guarda. Formato estrutural: o estado da fábrica o satisfaz. */
export interface PerguntaCriada {
  n: number;
  origin: OrigemPergunta;
  purpose?: "repositorio";
  to: string;
  text: string;
  ref: QuestionRef;
  askedAt: number;
  remindAt: number;
  notifyAt: number;
  reminded: boolean;
  notified: boolean;
  answer: null;
  publication?: "draft";
  teamsNotice?: { userId: string; link: string; status: "pending" };
}

/** Pessoa a quem a pergunta vai, com a identidade dela no Teams, se houver. */
export interface Destinatario {
  id: string;
  teamsUserId?: string;
}

/** Erro de negócio: a pergunta não pode ser levada agora. Quem chama o converte no bloqueio da etapa. */
export class PerguntaBloqueada extends Error {
  override name = "PerguntaBloqueada";
}

/** Configuração do projeto que a criação da pergunta lê. */
export interface ConfiguracaoPergunta {
  dryRun: boolean;
  questionApproval: boolean;
  /** Origem da Fonte, para montar o link do card; sem ela, não há aviso ao Teams com link. */
  baseUrl?: string;
  calendario: BusinessCalendar;
  /** `true` quando o Teams está configurado neste daemon. */
  teamsDisponivel: boolean;
}

/**
 * Dependências da criação. A criação conhece a regra da pergunta (quem responde, limites, prazos, aviso ao Teams);
 * o que acontece fora dela (canal, estado durável, eventos, prazo técnico, validação do repositório) é porta.
 */
export interface PortasCriacao {
  configuracao(projeto: string): ConfiguracaoPergunta;
  /** Destinatário: o PO para perguntas do grill, o responsável técnico para as técnicas. */
  destinatario(projeto: string, tecnica: boolean): Destinatario | undefined;
  /** Lança se o responsável técnico não estiver configurado como pessoa do projeto. */
  validarDestinatarioTecnico(projeto: string): void;
  /** Envia a pergunta pelo Canal e devolve a referência. Só é chamada quando a pergunta não passa por aprovação. */
  perguntarNoCanal(input: { card: string; to: string; text: string }): Promise<QuestionRef>;
  /** Prazo de lembrete de uma pergunta técnica (120 minutos úteis). */
  prazoPerguntaTecnica(disponibilizadaEm: number): number;
  agora(): number;
  /** Grava a pergunta na Tarefa, se ainda não houver uma com esse número. */
  gravar(tarefaId: string, pergunta: PerguntaCriada): Promise<void>;
  avisarTeams(tarefaId: string, projeto: string, chave: string, n: number): Promise<void>;
  registrarEnviada(evento: {
    type: "question";
    project: string;
    target: string;
    n: number;
    to: string;
    text: string;
    status: "enviada";
  }): Promise<void>;
}

/** Tarefa que levanta a pergunta. */
export interface AlvoCriacao {
  id: string;
  projeto: string;
  chave: string;
}

/**
 * Leva uma pergunta ao PO (ou ao responsável técnico, nas técnicas): confere destinatário e limites, envia pelo Canal
 * (salvo se a pergunta passa por aprovação), grava com os prazos e, se não houver aprovação, avisa o Teams e registra
 * o evento. Com aprovação, a pergunta fica em rascunho e só sai depois da revisão.
 */
export async function levarPergunta(
  portas: PortasCriacao,
  alvo: AlvoCriacao,
  anteriores: { n: number }[],
  texto: string,
  origem: OrigemPergunta,
  finalidade?: "repositorio",
): Promise<void> {
  const tecnica = origem === "tecnica";
  const config = portas.configuracao(alvo.projeto);
  if (tecnica) {
    try {
      portas.validarDestinatarioTecnico(alvo.projeto);
    } catch (erro) {
      throw new PerguntaBloqueada((erro as Error).message);
    }
  }
  const po = portas.destinatario(alvo.projeto, tecnica);
  if (!po) throw new PerguntaBloqueada(`o grill precisa perguntar ao PO, mas o projeto ${alvo.projeto} não declara um`);
  if (!tecnica && po.teamsUserId && (!config.baseUrl || !config.teamsDisponivel))
    throw new PerguntaBloqueada("aviso ao PO no Teams configurado sem origem Jira ou conexão MCP");
  if (anteriores.length >= MAX_PERGUNTAS_PO)
    throw new PerguntaBloqueada(
      `o grill já fez ${MAX_PERGUNTAS_PO} perguntas ao PO e ainda quer perguntar: "${texto}"`,
    );

  const n = anteriores.length + 1;
  const ref =
    tecnica || config.questionApproval
      ? { card: alvo.chave, to: po.id, before: [] }
      : await portas.perguntarNoCanal({ card: alvo.chave, to: po.id, text: `Pergunta ${n}: ${texto}` });
  const perguntadaEm = portas.agora();
  const pergunta: PerguntaCriada = {
    n,
    origin: origem,
    ...(finalidade ? { purpose: finalidade } : {}),
    to: po.id,
    text: texto,
    ref,
    askedAt: perguntadaEm,
    remindAt: tecnica
      ? portas.prazoPerguntaTecnica(perguntadaEm)
      : addBusinessHours(config.calendario, perguntadaEm, HORAS_ATE_LEMBRETE),
    notifyAt: addBusinessHours(config.calendario, perguntadaEm, workdayHours(config.calendario)),
    reminded: false,
    notified: false,
    answer: null,
    ...(!tecnica && config.questionApproval ? { publication: "draft" as const } : {}),
    ...(!tecnica && po.teamsUserId && config.baseUrl && !config.dryRun
      ? {
          teamsNotice: {
            userId: po.teamsUserId,
            link: `${config.baseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(alvo.chave)}`,
            status: "pending" as const,
          },
        }
      : {}),
  };
  await portas.gravar(alvo.id, pergunta);
  if (!tecnica && config.questionApproval) return;
  await portas.avisarTeams(alvo.id, alvo.projeto, alvo.chave, n);
  await portas.registrarEnviada({
    type: "question",
    project: alvo.projeto,
    target: alvo.chave,
    n,
    to: po.id,
    text: texto,
    status: "enviada",
  });
}
