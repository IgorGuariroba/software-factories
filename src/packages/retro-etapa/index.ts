// Entry point público da retrô de uma etapa: decide se a etapa tem o que revisar, roda a retrô e, com aprovação, segura a
// Tarefa antes da próxima etapa até a pessoa revisar. A execução da retrô e a gravação da pausa são portas.

export { type EventoIncidente, entradaDaRetro, type TarefaRetrospectiva } from "./lib/entrada.js";
export { type AlvoRetro, concluirRetro, type EtapaRetro, type PortasRetro, type TarefaRetro } from "./lib/retro.js";
