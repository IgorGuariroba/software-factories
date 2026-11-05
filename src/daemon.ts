import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { ProjectConfig } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import { type RunningFactory, startFactory } from "./factory.js";

/** Como criar a Fonte de cada tipo declarado em `source.type`. */
export type SourceFactories = Record<ProjectConfig["source"]["type"], (config: ProjectConfig) => DemandSource>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Lê e valida todos os `*.yaml` de `dir`. Junta os erros de todos os arquivos numa única mensagem. */
export async function loadProjects(dir: string): Promise<ProjectConfig[]> {
  const files = (await readdir(dir)).filter((f) => /\.ya?ml$/.test(f)).sort();
  if (files.length === 0) throw new ConfigError(`Nenhum projeto configurado em ${dir}`);

  const configs: ProjectConfig[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const result = ProjectConfig.safeParse(parse(await readFile(join(dir, file), "utf8")));
    if (result.success) configs.push(result.data);
    else for (const issue of result.error.issues) errors.push(`${file}: ${issue.path.join(".")}: ${issue.message}`);
  }
  if (errors.length > 0) throw new ConfigError(`Config de projeto inválida:\n${errors.join("\n")}`);
  return configs;
}

export async function startDaemon(opts: {
  configDir: string;
  sources: SourceFactories;
  port?: number;
}): Promise<RunningFactory> {
  const configs = await loadProjects(opts.configDir);
  return startFactory({
    port: opts.port,
    projects: configs.map((config) => ({ config, source: opts.sources[config.source.type](config) })),
  });
}
