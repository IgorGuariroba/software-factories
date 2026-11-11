import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ProjectConfig } from "./config.js";
import { ConfigError, startDaemon } from "./daemon.js";
import { createFactoryModels } from "./factory-models.js";
import { createGitHubDemandSource } from "./github-demand-source.js";
import { createGitLabDemandSource } from "./gitlab-demand-source.js";
import { createJiraDemandSource } from "./jira-demand-source.js";
import { createSecretStore } from "./packages/secret-store/index.js";
import { isRetroRepository } from "./retro-settings.js";
import { createGhRetroSink } from "./retro-sink.js";
import { createTeamsMcpConversation } from "./teams-conversa.js";
import { createTeamsMcpNotifier } from "./teams-mcp.js";
import { createTelegramBot } from "./telegram.js";

const configDir = process.env.FACTORY_CONFIG_DIR ?? join(homedir(), ".config", "software-factory", "projects");
const port = Number(process.env.FACTORY_PORT ?? 7420);
const statePath =
  process.env.FACTORY_STATE_PATH ?? join(homedir(), ".local", "state", "software-factory", "fabrica.sqlite");
/** Cofre das credenciais, ao lado do estado durável (mesmo diretório que o da factory). */
const cofre = createSecretStore({ dir: join(dirname(statePath), "segredos") });
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

/** A Fonte da configuração, se ela é do tipo pedido; senão, erro (o adaptador não pode ser montado para outra Fonte). */
function fonteDe<T extends ProjectConfig["source"]["type"]>(
  config: ProjectConfig,
  tipo: T,
): Extract<ProjectConfig["source"], { type: T }> {
  if (config.source.type !== tipo) throw new Error(`projeto ${config.name} não é ${tipo}`);
  return config.source as Extract<ProjectConfig["source"], { type: T }>;
}

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

/**
 * Webhook do GitHub App: porta local do receptor (um túnel encaminha o GitHub até ela) e o secret do App. O secret sai
 * do ambiente do processo logo após a leitura, como o token do Telegram: git, testes e acli não o herdam.
 */
function webhookFromEnv(): { port: number; secret: string } | undefined {
  const rawPort = process.env.FACTORY_WEBHOOK_PORT;
  const secret = process.env.FACTORY_GITHUB_WEBHOOK_SECRET;
  delete process.env.FACTORY_GITHUB_WEBHOOK_SECRET;
  if (!rawPort) {
    if (secret) console.warn("[fábrica] webhook desligado: defina FACTORY_WEBHOOK_PORT para ligá-lo.");
    return undefined;
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`FACTORY_WEBHOOK_PORT inválido: "${rawPort}" (use uma porta de 1 a 65535)`);
    process.exit(1);
  }
  if (!secret) {
    console.error("FACTORY_GITHUB_WEBHOOK_SECRET ausente: o receptor do webhook exige o secret do GitHub App");
    process.exit(1);
  }
  return { port, secret };
}

/**
 * Painel do GitHub App (só leitura): App ID numérico e caminho do arquivo da chave privada. Nada é lido aqui; a chave
 * só é aberta quando o painel consulta o GitHub. Sem as duas variáveis, o painel mostra que o App não está configurado.
 */
function githubAppFromEnv(): { appId?: number; privateKeyPath?: string } {
  const rawId = process.env.FACTORY_GITHUB_APP_ID?.trim();
  const privateKeyPath = process.env.FACTORY_GITHUB_APP_PRIVATE_KEY_PATH?.trim() || undefined;
  if (!rawId) return { privateKeyPath };
  const appId = Number(rawId);
  if (!Number.isInteger(appId) || appId <= 0) {
    console.error(`FACTORY_GITHUB_APP_ID inválido: "${rawId}" (use o número do App)`);
    process.exit(1);
  }
  return { appId, privateKeyPath };
}

/** Repositório público da fábrica para as issues de retrô (`dono/nome`). Sem ele, as propostas só ficam registradas. */
const retroRepo = process.env.FACTORY_RETRO_REPO?.trim() || undefined;
if (retroRepo && !isRetroRepository(retroRepo)) {
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
      jira: (config) => {
        const fonte = fonteDe(config, "jira");
        // Credencial do cofre (ADR-0018): o token sai do cofre pelo nome guardado na configuração, a cada download.
        const { credential, email } = fonte;
        return createJiraDemandSource({
          project: fonte.project,
          assignee: fonte.assignee,
          baseUrl: fonte.baseUrl,
          ...(credential && email
            ? {
                credentials: async () => {
                  const token = await cofre.get(credential);
                  return token ? { email, token } : undefined;
                },
              }
            : {}),
        });
      },
      gitlab: (config) => {
        const fonte = fonteDe(config, "gitlab");
        const credencialGitLab = fonte.credential ?? "";
        return createGitLabDemandSource({
          project: fonte.project,
          repo: fonte.repo,
          assignee: fonte.assignee,
          ...(fonte.hostname ? { hostname: fonte.hostname } : {}),
          ignoreLabels: fonte.ignoreLabels,
          // Token do GitLab no cofre pelo nome da credencial (ADR-0018); sem credencial, vale o login do glab.
          ...(fonte.credential ? { token: () => cofre.get(credencialGitLab) } : {}),
        });
      },
      // Repositório monitorado (ADR-0014): toda issue aberta passa pela triagem antes da SPEC.
      github: (config) => {
        const fonte = fonteDe(config, "github");
        const credencialGitHub = fonte.credential;
        return createGitHubDemandSource({
          project: fonte.project,
          repo: fonte.repo,
          assignee: fonte.assignee,
          ignoreLabels: fonte.ignoreLabels,
          // Token do GitHub no cofre pelo nome da credencial (ADR-0018); sem credencial, vale o login do gh.
          ...(credencialGitHub ? { token: () => cofre.get(credencialGitHub) } : {}),
        });
      },
    },
    // Credenciais do pi e chaves do ambiente; seleção por regras e allowlist vêm na M1-16.
    models: await createFactoryModels(),
    management: telegramFromEnv(),
    // Interface salva pela API (fatia 09): o token vem do cofre, nunca do ambiente.
    criarInterfaceTelegram: (token, chat) => createTelegramBot({ token, chat }),
    teams: teamsClient && createTeamsMcpNotifier(teamsClient),
    teamsConversation: teamsClient && createTeamsMcpConversation(teamsClient),
    retro: { sink: createGhRetroSink(), repo: retroRepo },
    webhook: webhookFromEnv(),
    githubApp: githubAppFromEnv(),
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
