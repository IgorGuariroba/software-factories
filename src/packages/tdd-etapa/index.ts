// Entry point público das regras do TDD da implementação: a sequência de passos, o que já está feito, o registro de um commit
// aceito e de uma recusa, e o limite de recusas. A execução (implementador, suíte, git) fica com a etapa.

export { arquivosForaDaFase, type ExecucaoSuite, julgamentoDaSuite, regraDaFase } from "./lib/fase.js";
export { type FatosDaFormatacao, formatacaoAceitavel } from "./lib/formatacao.js";
export {
  type FaseTdd,
  MAX_RECUSAS_TDD,
  type PassoTdd,
  type ProgressoTdd,
  passoFeito,
  passosDoTdd,
  proximoPasso,
  recusasEsgotadas,
  registrarCommitAceito,
  registrarRecusaTdd,
} from "./lib/passos.js";
