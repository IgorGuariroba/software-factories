// Entry point público do pacote de credenciais (ADR-0018): cofre cifrado em disco, sem exibir valores.
export { createSecretStore, type SecretInfo, type SecretStore } from "./lib/cofre.js";
