import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Models } from "@earendil-works/pi-ai";
import { parse } from "yaml";
import { ProjectConfig } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import { type RunningFactory, startFactory } from "./factory.js";
import type { ManagementInterface } from "./management.js";
import type { RetroSink } from "./retro-sink.js";
import type { TeamsNotifier } from "./teams-mcp.js";

/** Como criar a Fonte de cada tipo declarado em `source.type`. */
export type SourceFactories = Partial<Record<ProjectConfig["source"]["type"], (config: ProjectConfig) => DemandSource>>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

function sourceFor(sources: SourceFactories, config: ProjectConfig): DemandSource {
  const create = sources[config.source.type];
  if (!create) throw new ConfigError(`projeto ${config.name}: Fonte "${config.source.type}" não disponível`);
  return create(config);
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
  /** Interface de gestão (Telegram), global ao daemon: um bot e uma conversa para todos os projetos. */
  management?: { port: ManagementInterface; chat: string; user?: string };
  /** Issues da fábrica: a porta e o repositório público da fábrica (global ao daemon). */
  retro?: { sink?: RetroSink; repo?: string };
  /** Receptor do webhook do GitHub App (global ao daemon). Sem ele, a fábrica não recebe entregas. */
  webhook?: { port: number; secret: string };
}): Promise<RunningFactory> {
  const configs = await loadProjects(opts.configDir);
  return startFactory({
    webhook: opts.webhook,
    port: opts.port,
    statePath: opts.statePath,
    pollIntervalMs: opts.pollIntervalMs,
    models: opts.models,
    teams: opts.teams,
    management: opts.management,
    retro: opts.retro,
    // O conhecimento de cada projeto fica ao lado da config: <configDir>/<projeto>/knowledge.md (ADR-0010).
    projects: configs.map((config) => ({
      config,
      source: sourceFor(opts.sources, config),
      knowledgeDir: join(opts.configDir, config.name),
    })),
  });
}
