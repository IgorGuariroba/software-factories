import type { RepoMapping } from "../../../config.js";
import { repositoryFromAnswer } from "../../../repo-resolver.js";
import { respostaNaoSei } from "../../../resposta-tecnica.js";

/** Pergunta como a resposta a enxerga: o que ela lê e grava. */
export interface PerguntaResposta {
  n: number;
  origin: "grill" | "card-raso" | "tecnica";
  purpose?: "repositorio";
  to: string;
  text: string;
  answer: string | null;
  publication?: "draft" | "sending" | "sent";
  userResponse?: string;
  needsForwarding?: boolean;
}

/** Tarefa como a resposta a enxerga. */
export interface TarefaResposta {
  id: string;
  project: string;
  key: string;
  status: string;
  repositoryPath?: string;
  questions?: PerguntaResposta[];
}

/** Parte do estado que a resposta lê e grava. Formato estrutural: o estado da fábrica o satisfaz. */
export interface EstadoResposta {
  tasks: TarefaResposta[];
}

/** Evento de pergunta respondida ou encaminhada. */
export interface EventoResposta {
  type: "question";
  project: string;
  target: string;
  n: number;
  to: string;
  text: string;
  status: "respondida" | "encaminhar";
}

/** Dependências da resposta de uma pergunta. */
export interface PortasResposta {
  alterar<T>(fn: (estado: EstadoResposta) => T): Promise<T>;
  /** Mapeamentos de repositório do projeto (para perguntas técnicas de repositório). */
  repositoriosDoProjeto(projeto: string): readonly RepoMapping[] | undefined;
  /** Grava a resposta na pergunta e devolve a Tarefa à fila. `false` se a pergunta já tinha resposta. */
  registrarResposta(estado: EstadoResposta, id: string, n: number, resposta: string): boolean;
  registrarEvento(evento: EventoResposta): Promise<void>;
  /** Leva a pergunta técnica ao responsável técnico, quando a resposta não resolve. */
  encaminharTecnica(id: string, n: number): Promise<void>;
  /** Acorda o escalonador: há resposta nova a conferir. */
  pedirReacao(): void;
}

/** Resposta do usuário a uma pergunta. Devolve `true` se foi registrada. */
export async function responderPergunta(
  portas: PortasResposta,
  id: string,
  n: number,
  resposta: string,
): Promise<boolean> {
  if (!Number.isSafeInteger(n) || n < 1 || !resposta.trim() || resposta.length > 20_000) return false;
  const gravada = await portas.alterar((estado) => {
    const tarefa = estado.tasks.find((t) => t.id === id);
    const pergunta = tarefa?.questions?.find((item) => item.n === n);
    if (
      !tarefa ||
      !pergunta ||
      !["aguardando-humano", "pausada"].includes(tarefa.status) ||
      pergunta.answer !== null ||
      pergunta.publication === "sending"
    )
      return undefined;
    const texto = resposta.trim();
    const encaminhar = pergunta.origin === "tecnica" && respostaNaoSei(texto);
    if (pergunta.purpose === "repositorio" && !encaminhar) {
      const mapeamento = repositoryFromAnswer(portas.repositoriosDoProjeto(tarefa.project), texto);
      // Texto vago, caminho arbitrário ou prefixo ambíguo não são resolução.
      if (!mapeamento) return undefined;
      tarefa.repositoryPath = mapeamento.path;
    }
    if (encaminhar) {
      pergunta.userResponse = texto;
      pergunta.needsForwarding = true;
    } else {
      portas.registrarResposta(estado, id, n, texto);
      pergunta.needsForwarding = false;
    }
    return {
      project: tarefa.project,
      target: tarefa.key,
      to: pergunta.to,
      text: encaminhar ? texto : pergunta.text,
      status: encaminhar ? ("encaminhar" as const) : ("respondida" as const),
    };
  });
  if (!gravada) return false;
  await portas.registrarEvento({ type: "question", ...gravada, n });
  if (gravada.status === "encaminhar") await portas.encaminharTecnica(id, n);
  portas.pedirReacao();
  return true;
}
