import { homedir } from "node:os";
import { join } from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { ConfigError, startDaemon } from "./daemon.js";
import { createJiraDemandSource } from "./jira-demand-source.js";
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

try {
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
        }),
    },
    // Provedores com as chaves do ambiente; a seleção por regras e a allowlist vêm na M1-16.
    models: builtinModels(),
    management: telegramFromEnv(),
  });
  console.log(`[fábrica] API local em ${daemon.url}`);
  const stop = () => void daemon.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
