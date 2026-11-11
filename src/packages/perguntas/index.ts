// Entry point público do módulo de Perguntas: confere respostas pelo Canal e cuida do aviso ao Teams. Fala só com a porta
// de Canal e com o canal de avisos; o estado e os eventos são gravados pela fábrica, por portas.
import { avisarTeams } from "./lib/aviso.js";
import type { PortasPerguntas } from "./lib/portas.js";
import { conferirResposta, verificarRespostas } from "./lib/respostas.js";

export {
  type AlvoCriacao,
  type ConfiguracaoPergunta,
  type Destinatario,
  HORAS_ATE_LEMBRETE,
  levarPergunta,
  MAX_PERGUNTAS_PO,
  type OrigemPergunta,
  PerguntaBloqueada,
  type PerguntaCriada,
  type PortasCriacao,
} from "./lib/criar.js";
export {
  type AlvoEscalonamento,
  type EventoEscalonamento,
  escalonarPergunta,
  type PerguntaEscalonavel,
  type PortasEscalonamento,
} from "./lib/escalonar.js";
export { textoDoLembrete } from "./lib/lembrete.js";
export type {
  EstadoPerguntas,
  EventoPergunta,
  PerguntaFila,
  PortasPerguntas,
  ProjetoPerguntas,
  TarefaPerguntas,
} from "./lib/portas.js";
export {
  type EstadoResposta,
  type EventoResposta,
  type PerguntaResposta,
  type PortasResposta,
  responderPergunta,
  type TarefaResposta,
} from "./lib/responder.js";

export interface Perguntas {
  /** Uma passada de verificação: avisos pendentes ao Teams e respostas chegadas pelo Canal. */
  verificar(): Promise<void>;
  /** Confere uma pergunta pelo Canal: `true` se a resposta chegou (e foi registrada). */
  conferir(tarefaId: string, n: number): Promise<boolean>;
  /** Aviso ao Teams de uma pergunta recém-publicada. */
  avisarTeams(tarefaId: string, projeto: string, chave: string, n: number): Promise<void>;
}

export function criarPerguntas(portas: PortasPerguntas): Perguntas {
  return {
    verificar: () => verificarRespostas(portas),
    conferir: (tarefaId, n) => conferirResposta(portas, tarefaId, n),
    avisarTeams: (tarefaId, projeto, chave, n) => avisarTeams(portas, tarefaId, projeto, chave, n),
  };
}
export {
  type PerguntaComResposta,
  pendingQuestion,
  registrarRespostaNoEstado,
  type TarefaRespondivel,
} from "./lib/estado.js";
