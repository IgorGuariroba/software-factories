import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Models } from "@earendil-works/pi-ai";
import { parse } from "yaml";
import { ProjectConfig } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import { type RunningFactory, startFactory } from "./factory.js";
import type { ManagementInterface } from "./management.js";
import { createIntegrationRegistry, type Registro } from "./packages/integracoes/index.js";
import type { RetroSink } from "./retro-sink.js";
import type { TeamsConversation } from "./teams-conversa.js";
import type { TeamsNotifier } from "./teams-mcp.js";

/** Como criar a Fonte de cada tipo declarado em `source.type`. */
export type SourceFactories = Partial<Record<ProjectConfig["source"]["type"], (config: ProjectConfig) => DemandSource>>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Monta o registro de Fontes a partir das fábricas recebidas: cada tipo registrado vira uma integração criável. */
function sourceRegistry(sources: SourceFactories): Registro<ProjectConfig, DemandSource> {
  const registro = createIntegrationRegistry<ProjectConfig, DemandSource>("Fonte");
  for (const [tipo, fabrica] of Object.entries(sources)) if (fabrica) registro.register(tipo, fabrica);
  return registro;
}

function sourceFor(registro: Registro<ProjectConfig, DemandSource>, config: ProjectConfig): DemandSource {
  if (!registro.tem(config.source.type))
    throw new ConfigError(`projeto ${config.name}: Fonte "${config.source.type}" não disponível`);
  return registro.create(config.source.type, config);
}

/** Lê e valida todos os `*.yaml` de `dir`. Junta os erros de todos os arquivos numa única mensagem. */
export async function loadProjects(dir: string): Promise<ProjectConfig[]> {
  const files = (await readdir(dir)).filter((f) => /\.ya?ml$/.test(f)).sort();
  if (files.length === 0) throw new ConfigError(`Nenhum projeto configurado em ${dir}`);

  const configs: ProjectConfig[] = [];
  const errors: string[] = [];
  for (const file of files) {
    let raw: unknown;
    try {
      raw = parse(await readFile(join(dir, file), "utf8"));
    } catch (err) {
      errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const result = ProjectConfig.safeParse(raw);
    if (result.success) configs.push(result.data);
    else for (const issue of result.error.issues) errors.push(`${file}: ${issue.path.join(".")}: ${issue.message}`);
  }
  if (errors.length > 0) throw new ConfigError(`Config de projeto inválida:\n${errors.join("\n")}`);
  return configs;
}

export async function startDaemon(opts: {
  configDir: string;
  sources: SourceFactories;
  /** Arquivo SQLite do estado durável. */
  statePath: string;
  port?: number;
  pollIntervalMs?: number;
  /** Provedores de modelos com as credenciais do usuário. */
  models: Models;
  /** Avisos Teams ao PO. */
  teams?: TeamsNotifier;
  /** Conversa 1:1 das pessoas no Teams: canal `teams` de perguntas e respostas (fatia 08). */
  teamsConversation?: TeamsConversation;
  /** Interface de gestão (Telegram), global ao daemon: um bot e uma conversa para todos os projetos. */
  management?: { port: ManagementInterface; chat: string; user?: string };
  /** Cria a interface de gestão salva pela API, com o token do cofre (fatia 09). */
  criarInterfaceTelegram?: (token: string, chat: string) => ManagementInterface;
  /** Issues da fábrica: a porta e o repositório público da fábrica (global ao daemon). */
  retro?: { sink?: RetroSink; repo?: string };
  /** Receptor do webhook do GitHub App (global ao daemon). Sem ele, a fábrica não recebe entregas. */
  webhook?: { port: number; secret: string };
  /** App ID e chave privada do GitHub App, para o painel de Configurações (só leitura). */
  githubApp?: { appId?: number; privateKeyPath?: string };
}): Promise<RunningFactory> {
  const configs = await loadProjects(opts.configDir);
  const fontes = sourceRegistry(opts.sources);
  return startFactory({
    webhook: opts.webhook,
    githubApp: opts.githubApp,
    port: opts.port,
    statePath: opts.statePath,
    pollIntervalMs: opts.pollIntervalMs,
    models: opts.models,
    teams: opts.teams,
    teamsConversation: opts.teamsConversation,
    management: opts.management,
    criarInterfaceTelegram: opts.criarInterfaceTelegram,
    retro: opts.retro,
    // Projetos criados pela interface (ADR-0016) usam a mesma Fonte e o mesmo lugar de conhecimento dos do YAML.
    createSource: (config) => sourceFor(fontes, config),
    knowledgeDirFor: (name) => join(opts.configDir, name),
    // O conhecimento de cada projeto fica ao lado da config: <configDir>/<projeto>/knowledge.md (ADR-0010).
    projects: configs.map((config) => ({
      config,
      source: sourceFor(fontes, config),
      knowledgeDir: join(opts.configDir, config.name),
    })),
  });
}
