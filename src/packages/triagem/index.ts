// Entry point público do módulo de Triagem: decide o que fazer com a triagem de uma issue (aceitar, adiar, recusar ou
// aguardar a pessoa). Como o resultado é obtido (sinais da Fonte, regras, modelo) fica com a fábrica, pela porta
// `avaliar`. Quem chama recebe só o desfecho.
import { decidirTriagem } from "./lib/decidir.js";
import type { AlvoTriagem, PortasTriagem } from "./lib/portas.js";

export { decidirTriagem } from "./lib/decidir.js";
export type {
  AlvoTriagem,
  DesfechoTriagem,
  EstadoTriagem,
  MotivoFechamento,
  PortasTriagem,
  RegistroTriagem,
  TarefaTriagem,
} from "./lib/portas.js";

/** Triagem de uma Tarefa com as portas dela. */
export function triagemDaTarefa(portas: PortasTriagem, alvo: AlvoTriagem) {
  return decidirTriagem(portas, alvo);
}

export { avaliarIssue, type ColetaIssue, type ContextoTriagem, type PortasAvaliacao } from "./lib/avaliar.js";
