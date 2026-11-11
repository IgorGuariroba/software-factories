// Entry point público da orquestração de Tarefa nas etapas de revisão e entrega: retomada de correções, ciclo de
// revisão e lotes de entrega, com progresso sem repetição. O trabalho (implementar, revisar, entregar) é da fábrica,
// injetado pelas portas em `lib/portas.ts`.

export { type EventoAssumido, esperaVetoAoAssumir, jaAnunciouAssumido } from "./lib/assumir.js";
export { branchRevisada, type EntradaBranch } from "./lib/branch.js";
export { esperaPessoa, type TarefaAguardandoPessoa } from "./lib/espera.js";
export { type DesfechoEtapa, type EntregaSpec, executarEtapa, type PortasExecucao } from "./lib/etapa.js";
export { ciclarRevisao, executarEntrega, retomarCorrecoes, situacaoDaRequisicao } from "./lib/etapas.js";
export { entregaParaImplementar, podeReavaliarCorrecoes, resultadoDaReavaliacao } from "./lib/implementacao.js";
export type {
  DesfechoEntrega,
  FeedbackPublicacao,
  PortasEtapa,
  TarefaEtapa,
} from "./lib/portas.js";
export { conversasExcluidasDaSpec, deveRegistrarProgresso } from "./lib/progresso.js";
export { escolherRepositorio, type PortasRepositorio } from "./lib/repositorio.js";
