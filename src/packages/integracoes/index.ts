// Entry point público do pacote de integrações: registro de tipos de Fonte e de Canal, e checagem de conexão.

export type { CampoEsquema, EsquemaFonte } from "./lib/esquemas.js";
export { testarConexaoJira } from "./lib/jira-conexao.js";
export { createIntegrationRegistry, type Registro } from "./lib/registro.js";
