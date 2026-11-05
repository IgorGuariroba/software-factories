import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError, startDaemon } from "./daemon.js";
import type { DemandSource } from "./demand-source.js";

const configDir = process.env.FACTORY_CONFIG_DIR ?? join(homedir(), ".config", "software-factory", "projects");
const port = Number(process.env.FACTORY_PORT ?? 7420);
const pollIntervalMs = Number(process.env.FACTORY_POLL_SECONDS ?? 300) * 1000;

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
  addComment: notYet,
  editComment: notYet,
  transition: notYet,
};

try {
  const daemon = await startDaemon({ configDir, port, pollIntervalMs, sources: { jira: () => pendingJira } });
  console.log(`[fábrica] API local em ${daemon.url}`);
  const stop = () => void daemon.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
