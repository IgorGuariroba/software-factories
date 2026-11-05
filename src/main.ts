import { homedir } from "node:os";
import { join } from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { ConfigError, startDaemon } from "./daemon.js";
import type { DemandSource } from "./demand-source.js";

const configDir = process.env.FACTORY_CONFIG_DIR ?? join(homedir(), ".config", "software-factory", "projects");
const port = Number(process.env.FACTORY_PORT ?? 7420);
const statePath =
  process.env.FACTORY_STATE_PATH ?? join(homedir(), ".local", "state", "software-factory", "fabrica.sqlite");
const pollSeconds = Number(process.env.FACTORY_POLL_SECONDS ?? 300);
/** Maior atraso aceito por setInterval; acima disso o Node usa 1 ms. */
const MAX_TIMER_MS = 2_147_483_647;
if (!Number.isFinite(pollSeconds) || pollSeconds <= 0 || pollSeconds * 1000 > MAX_TIMER_MS) {
  console.error(
    `FACTORY_POLL_SECONDS inválido: "${process.env.FACTORY_POLL_SECONDS}" (use segundos > 0 e <= ${MAX_TIMER_MS / 1000})`,
  );
  process.exit(1);
}
const pollIntervalMs = pollSeconds * 1000;

// O adaptador real do Jira chega na M1-03 (#11). Até lá, a Fonte Jira responde vazio e recusa escritas.
const notYet = async (): Promise<never> => {
  throw new Error("Fonte jira ainda sem adaptador real (M1-03)");
};
const pendingJira: DemandSource = {
  async listAssignedCards() {
    console.warn("[fábrica] Fonte jira ainda sem adaptador real (M1-03); fila vazia.");
    return [];
  },
  getCard: async () => undefined,
  listComments: notYet,
  listTextAttachments: notYet,
  addComment: notYet,
  editComment: notYet,
  transition: notYet,
};

try {
  const daemon = await startDaemon({
    configDir,
    port,
    statePath,
    pollIntervalMs,
    sources: { jira: () => pendingJira },
    // Provedores com as chaves do ambiente; a seleção por regras e a allowlist vêm na M1-16.
    models: builtinModels(),
  });
  console.log(`[fábrica] API local em ${daemon.url}`);
  const stop = () => void daemon.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
