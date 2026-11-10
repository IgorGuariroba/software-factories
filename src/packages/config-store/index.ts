// Entry point público do pacote de configuração de projeto (ADR-0017, ADR-0018, ADR-0022).
export {
  type EstadoProjeto,
  estadoDoProjeto,
  pendenciasDeConfiguracao,
} from "./lib/ativacao.js";
export {
  type AlteracaoConfiguracao,
  type ConfiguracoesGuardadas,
  camposAlterados,
  lerConfiguracao,
  semearConfiguracoes,
} from "./lib/semeadura.js";
