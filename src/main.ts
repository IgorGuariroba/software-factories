import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ConfigError, startDaemon } from "./daemon.js";
import { createFactoryModels } from "./factory-models.js";
import { createGitHubDemandSource } from "./github-demand-source.js";
import { createJiraDemandSource } from "./jira-demand-source.js";
import { createGhRetroSink } from "./retro-sink.js";
import { createTeamsMcpNotifier } from "./teams-mcp.js";
import { createTelegramBot } from "./telegram.js";

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

/** Telegram: token e conversa pelo ambiente, nunca na config. Sem eles, o daemon sobe só com a API local. */
function telegramFromEnv() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  const user = process.env.TELEGRAM_USER_ID || undefined;
  // Fora do ambiente do processo, o token não chega aos processos filhos (git, testes, acli).
  delete process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("[fábrica] Telegram desligado: defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID para ligá-lo.");
    return undefined;
  }
  if (!chat) {
    console.warn("[fábrica] Telegram desligado: TELEGRAM_BOT_TOKEN está definido, mas falta TELEGRAM_CHAT_ID.");
    return undefined;
  }
  return { port: createTelegramBot({ token, chat }), chat, user };
}

/** Repositório público da fábrica para as issues de retrô (`dono/nome`). Sem ele, as propostas só ficam registradas. */
const retroRepo = process.env.FACTORY_RETRO_REPO?.trim() || undefined;
if (retroRepo && !/^[\w.-]+\/[\w.-]+$/.test(retroRepo)) {
  console.error(`FACTORY_RETRO_REPO inválido: "${retroRepo}" (use dono/nome)`);
  process.exit(1);
}

let teamsClient: Client | undefined;
try {
  const teamsCommand = process.env.FACTORY_TEAMS_MCP_COMMAND;
  if (teamsCommand) {
    teamsClient = new Client({ name: "software-factory", version: "1" });
    await teamsClient.connect(new StdioClientTransport({ command: teamsCommand, stderr: "ignore" }), {
      timeout: 30_000,
    });
  }
  const daemon = await startDaemon({
    configDir,
    port,
    statePath,
    pollIntervalMs,
    sources: {
      jira: (config) =>
        createJiraDemandSource({
          project: config.source.project,
          assignee: config.source.assignee,
          baseUrl: config.source.baseUrl,
        }),
      // Repositório monitorado (ADR-0014): toda issue aberta passa pela triagem antes da SPEC.
      github: (config) => {
        if (config.source.type !== "github") throw new Error(`projeto ${config.name} não é github`);
        return createGitHubDemandSource({
          project: config.source.project,
          repo: config.source.repo,
          assignee: config.source.assignee,
        });
      },
    },
    // Credenciais do pi e chaves do ambiente; seleção por regras e allowlist vêm na M1-16.
    models: await createFactoryModels(),
    management: telegramFromEnv(),
    teams: teamsClient && createTeamsMcpNotifier(teamsClient),
    retro: { sink: createGhRetroSink(), repo: retroRepo },
  });
  console.log(`[fábrica] API local em ${daemon.url}`);
  const stop = () =>
    void daemon
      .close()
      .then(() => teamsClient?.close())
      .then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (err) {
  await teamsClient?.close().catch(() => {});
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
