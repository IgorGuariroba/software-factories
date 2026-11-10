import { ProjectConfig } from "../../../config.js";

/**
 * Configurações de projeto guardadas no estado durável, por nome, como JSON (o estado precisa ser compatível com JSON).
 */
export type ConfiguracoesGuardadas = Record<string, string>;

/**
 * Semeia o estado com os projetos do YAML que ainda não estão nele (ADR-0017). Um projeto já guardado nunca é
 * sobrescrito: depois da primeira execução, o estado é quem manda, e mudanças no YAML não têm efeito.
 */
export function semearConfiguracoes(guardadas: ConfiguracoesGuardadas, yaml: ProjectConfig[]): ConfiguracoesGuardadas {
  const proximas = { ...guardadas };
  for (const config of yaml) {
    if (!(config.name in proximas)) proximas[config.name] = JSON.stringify(config);
  }
  return proximas;
}

/** A configuração guardada de um projeto, validada pelo schema; `undefined` se ausente ou inválida. */
export function lerConfiguracao(guardada: string | undefined): ProjectConfig | undefined {
  if (guardada === undefined) return undefined;
  const lida = ProjectConfig.safeParse(JSON.parse(guardada));
  return lida.success ? lida.data : undefined;
}

/** Um registro do histórico de alterações de configuração: sem valores, só os nomes dos campos (fatia 12). */
export interface AlteracaoConfiguracao {
  quando: string;
  autor: string;
  campos: string[];
}

/** Nomes dos campos de primeiro nível que mudaram entre a configuração anterior e a nova, em ordem estável. */
export function camposAlterados(antes: object, depois: object): string[] {
  const a = antes as Record<string, unknown>;
  const d = depois as Record<string, unknown>;
  const nomes = [...new Set([...Object.keys(a), ...Object.keys(d)])].sort();
  return nomes.filter((nome) => JSON.stringify(a[nome]) !== JSON.stringify(d[nome]));
}

/**
 * O que falta na configuração para a fábrica agir com segurança (fatia 11). Só avisos: a configuração salva mesmo
 * incompleta, e a interface lista as pendências.
 */
export function pendenciasDeConfiguracao(config: ProjectConfig): string[] {
  const pendencias: string[] = [];
  if (!config.people.some((p) => p.role === "po")) pendencias.push("falta uma pessoa no perfil PO");
  if (config.source.type === "jira" && !config.source.credential) pendencias.push("Fonte Jira sem credencial no cofre");
  return pendencias;
}
