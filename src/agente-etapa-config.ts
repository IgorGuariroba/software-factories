import type { ModelRef, ProjectConfig } from "./config.js";
import { type EtapaComFerramentas, FERRAMENTAS_DA_ETAPA, type NomeFerramenta } from "./ferramentas-catalogo.js";

export type { EtapaComFerramentas };

/** O que um Agente da etapa usa numa execução, já com o padrão embutido aplicado onde não há configuração gravada. */
export interface AgenteDaEtapa {
  etapa: EtapaComFerramentas;
  /** `undefined` só na revisão sem `roles.reviewer`, que já é recusada pela etapa de review como hoje. */
  modelo: ModelRef | undefined;
  promptAdicional: string;
  ferramentas: NomeFerramenta[];
  mcp: { servidor: string; ferramentas: string[] }[];
  /** Skills do projeto ativadas nesta etapa, na ordem escolhida. */
  skills: { nome: string; conteudo: string }[];
}

/** Modelo que a etapa usa quando não há modelo gravado: o mesmo papel que ela já usa hoje. */
function modeloPadrao(config: ProjectConfig, etapa: EtapaComFerramentas): ModelRef | undefined {
  switch (etapa) {
    case "spec":
      return config.roles.spec;
    case "review":
      return config.roles.reviewer;
    case "implementacao":
      return config.roles.implementer ?? config.roles.spec;
    case "retro":
      return config.roles.retro ?? config.roles.spec;
  }
}

/**
 * Resolve a configuração efetiva de uma etapa: o que foi gravado no projeto, e o padrão embutido para o resto.
 * Uma etapa sem configuração gravada se comporta exatamente como antes da configuração por etapa existir.
 */
export function resolverAgenteDaEtapa(config: ProjectConfig, etapa: EtapaComFerramentas): AgenteDaEtapa {
  const gravada = config.etapas?.[etapa];
  return {
    etapa,
    modelo: gravada?.modelo ?? modeloPadrao(config, etapa),
    promptAdicional: gravada?.promptAdicional ?? "",
    ferramentas: gravada?.ferramentas ?? [...FERRAMENTAS_DA_ETAPA[etapa]],
    mcp: gravada?.mcp ?? [],
    skills: (gravada?.skills ?? []).flatMap((nome) => {
      const skill = config.skills?.find((s) => s.nome === nome);
      return skill ? [{ nome: skill.nome, conteudo: skill.conteudo }] : [];
    }),
  };
}

/**
 * Texto que o agente da etapa acrescenta ao prompt base: o prompt adicional gravado e o conteúdo das skills ativas.
 * Sem nada gravado, devolve `undefined` e o prompt base vale como antes.
 */
export function textoAdicionalDoAgente(agente: AgenteDaEtapa): string | undefined {
  const partes = [
    agente.promptAdicional,
    ...agente.skills.map((skill) => `## Skill: ${skill.nome}\n${skill.conteudo}`),
  ].filter((parte) => parte.trim() !== "");
  return partes.length > 0 ? partes.join("\n\n") : undefined;
}

/** Prompt base da etapa, com o texto adicional gravado no projeto (se houver) depois dele. */
export function comPromptAdicional(base: string, adicional: string | undefined): string {
  return adicional ? `${base}\n\n${adicional}` : base;
}

/**
 * Escolhe, entre as instâncias que uma etapa tem, as que a configuração liga, na ordem gravada. Um nome do catálogo
 * que a etapa não implementa é recusado: a configuração nunca cria nem ignora uma ferramenta em silêncio.
 */
export function ferramentasParaEtapa<T extends { readonly name: string }>(
  instancias: readonly T[],
  nomes: readonly string[],
  etapa: string,
): T[] {
  return nomes.map((nome) => {
    const achada = instancias.find((t) => t.name === nome);
    if (!achada) throw new Error(`a ferramenta ${nome} não está disponível na etapa ${etapa}`);
    return achada;
  });
}
