// Entry point público do pacote de configuração de projeto (ADR-0017, ADR-0018).
export {
  type AlteracaoConfiguracao,
  type ConfiguracoesGuardadas,
  camposAlterados,
  lerConfiguracao,
  pendenciasDeConfiguracao,
  semearConfiguracoes,
} from "./lib/semeadura.js";
