// Entry point público das regras comuns às Fontes de demanda: o status de um card (fechado, rótulo `fabrica:<status>`, ou
// aberta). Cada Fonte traduz o próprio formato; a regra é esta.

export { chaveDoCard, mencaoDePessoa, numeroDaChave } from "./lib/chave.js";
export { temRotuloIgnorado } from "./lib/rotulos.js";
export { CLOSED_STATUS, OPEN_STATUS, STATUS_LABEL, statusDoCard } from "./lib/status.js";
