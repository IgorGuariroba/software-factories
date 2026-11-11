/** Botão de uma mensagem de gestão: o rótulo e o comando que ele dispara. */
export interface BotaoGestao {
  label: string;
  command: string;
}

/** Mensagem da gestão (Telegram): o texto e, quando faz sentido, os botões. */
export interface MensagemGestao {
  text: string;
  buttons?: BotaoGestao[];
}

/** Evento da fábrica como a apresentação o usa: só os campos que a mensagem escolhe. */
export type EventoApresentado =
  | { type: "question"; project: string; target: string; n: number; text: string; status: string }
  | { type: "assumed"; project: string; target: string; title: string; waitsVeto?: boolean }
  | { type: "notify"; project: string; target: string; reason: string; message: string; until?: string }
  | { type: "retro"; project: string; target: string; stage: string; status: string; message: string }
  | { type: "blocked"; project: string; target: string; action: string; reason: string }
  | { type: "task"; project: string; key: string; id: string; status: string; reason?: string | null };

/** Final de texto que vale quando o conteúdo completo não sai no Telegram: aponta para a interface web local. */
export const SEM_CONTEUDO = ". Consulte a interface web local para ver o conteúdo.";
/** Aviso de pergunta em rascunho: nada sai ao PO até a aprovação na interface web. */
export const RASCUNHO_PERGUNTA =
  "\nRascunho não enviado ao PO. Para publicar, revise e aprove na interface web local. /responder registra uma resposta local, sem publicar a pergunta.";
/** Instrução de resposta, no fim de toda pergunta que pede resposta pelo Telegram. */
export const TOQUE_RESPONDER = "\nToque em Responder para enviar sua resposta.";

/** Texto de uma pergunta ao PO (enviada ou pendente de reconciliação), com ou sem o conteúdo completo. */
export function textoDaPergunta(opts: {
  prefixo: string;
  n: number;
  chave: string;
  projeto: string;
  texto: string;
  completo: boolean;
  rascunho?: boolean;
}): string {
  return (
    `${opts.prefixo} ${opts.n} sobre ${opts.chave} (${opts.projeto})` +
    (opts.completo ? `: ${opts.texto}` : SEM_CONTEUDO) +
    (opts.rascunho ? RASCUNHO_PERGUNTA : "") +
    TOQUE_RESPONDER
  );
}

/** Texto do aviso de SPEC pronta para revisão. */
export function textoSpecPronta(chave: string, projeto: string): string {
  return `SPEC de ${chave} (${projeto}) pronta para revisão. Consulte a interface web local para revisar e aprovar.`;
}

/** Tipos de evento que a apresentação sabe escrever. Os demais (escritas, progresso…) não viram mensagem. */
const TIPOS_APRESENTADOS: ReadonlySet<string> = new Set(["question", "assumed", "notify", "retro", "blocked", "task"]);

/** O evento é de um tipo que a apresentação escreve? */
export function ehEventoApresentado(evento: { type: string } & Record<string, unknown>): evento is EventoApresentado {
  return TIPOS_APRESENTADOS.has(evento.type);
}

/** Dependências da apresentação: o relógio, a leitura das tarefas (que pode falhar) e o modo de conteúdo do projeto. */
export interface PortasApresentacao {
  agora(): number;
  /** Tarefas com o status da SPEC; lança se a leitura falhar. */
  tarefas(): Promise<{ id: string; specReview?: string | null }[]>;
  /** O projeto mostra o conteúdo completo no Telegram? Senão, só o aviso e a indicação da interface web. */
  conteudoCompleto(projeto: string | undefined): boolean;
}

/**
 * Mensagem de um evento para o Telegram, ou `null` se o evento não é para o usuário. Sem o conteúdo completo, o texto
 * aponta para a interface web em vez de mostrar o que foi dito.
 */
export async function mensagemDoEvento(
  evento: { type: string } & Record<string, unknown>,
  portas: PortasApresentacao,
): Promise<MensagemGestao | null> {
  if (!ehEventoApresentado(evento)) return null;
  const projeto = "project" in evento ? evento.project : undefined;
  const completo = portas.conteudoCompleto(projeto);
  switch (evento.type) {
    case "question": {
      if (evento.status !== "enviada") return null;
      return {
        text: textoDaPergunta({
          prefixo: "Pergunta",
          n: evento.n,
          chave: evento.target,
          projeto: evento.project,
          texto: evento.text,
          completo,
        }),
        buttons: [{ label: "Responder", command: `/responder ${evento.project}/${evento.target} ${evento.n}` }],
      };
    }
    case "assumed": {
      if (evento.waitsVeto) return null;
      const id = `${evento.project}/${evento.target}`;
      return {
        text: `Assumi o card ${evento.target} (${evento.project})${completo ? `: ${evento.title}` : "."}`,
        buttons: [
          { label: "Pausar", command: `/pausar ${id}` },
          { label: "Cancelar", command: `/cancelar ${id}` },
        ],
      };
    }
    case "notify": {
      const id = `${evento.project}/${evento.target}`;
      const ate = evento.until ? ` até ${evento.until}` : "";
      const text = completo
        ? `Aviso: ${evento.message}`
        : `Aviso (${evento.reason}) no card ${evento.target} (${evento.project})${ate}.`;
      const vetoAberto =
        evento.reason === "aguardando-veto" && evento.until && Date.parse(evento.until) > portas.agora();
      return vetoAberto ? { text, buttons: [{ label: "Vetar", command: `/vetar ${id}` }] } : { text };
    }
    case "retro":
      if (evento.status !== "falhou") return null;
      return {
        text: completo
          ? evento.message
          : `A retrô (${evento.stage}) do card ${evento.target} (${evento.project}) desistiu.`,
      };
    case "blocked":
      return {
        text: `Guardrail bloqueou ${evento.action} em ${evento.target} (${evento.project})${completo ? `: ${evento.reason}` : "."}`,
      };
    case "task": {
      if (evento.status === "aguardando-humano") {
        // Falha de leitura não pode prender o cursor e bloquear os próximos avisos.
        let tarefas: { id: string; specReview?: string | null }[];
        try {
          tarefas = await portas.tarefas();
        } catch {
          return {
            text: `A Tarefa ${evento.key} (${evento.project}) aguarda sua atenção. Consulte a interface web local.`,
          };
        }
        const tarefa = tarefas.find((t) => t.id === evento.id);
        if (tarefa?.specReview === "draft")
          return {
            text: textoSpecPronta(evento.key, evento.project),
          };
      }
      if (evento.status === "bloqueada")
        return {
          text: `A Tarefa ${evento.key} (${evento.project}) está bloqueada${completo && evento.reason ? `: ${evento.reason}` : "."}`,
        };
      if (evento.status === "concluida") return { text: `A Tarefa ${evento.key} (${evento.project}) terminou.` };
      return null;
    }
    default:
      return null;
  }
}
