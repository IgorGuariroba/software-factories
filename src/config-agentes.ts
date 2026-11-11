import { z } from "zod";
import { FERRAMENTAS, type NomeFerramenta } from "./ferramentas-catalogo.js";

/** Um modelo específico de um provedor (ex.: `{ provider: anthropic, model: claude-… }`). */
export const ModelRef = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  /** Família explícita para modelos cujo nome não identifica a linhagem (ex.: aliases privados). */
  family: z.string().min(1).optional(),
});
export type ModelRef = z.infer<typeof ModelRef>;

const NOMES_FERRAMENTAS = Object.keys(FERRAMENTAS) as [NomeFerramenta, ...NomeFerramenta[]];

/** Servidor MCP liberado para uma etapa, com as tools que ela pode usar (fatia 09). */
const McpDaEtapa = z.object({
  servidor: z.string().min(1),
  ferramentas: z.array(z.string().min(1)).default([]),
});

/**
 * Configuração gravada de uma etapa (Agente da etapa, ADR-0021). Campo ausente usa o padrão embutido de cada etapa.
 * Ferramentas só aceitam nomes do catálogo fechado.
 */
export const AgenteDaEtapaConfig = z.object({
  modelo: ModelRef.optional(),
  /** Texto acrescentado ao prompt base da etapa. Ausente: nenhum. */
  promptAdicional: z.string().optional(),
  ferramentas: z.array(z.enum(NOMES_FERRAMENTAS)).optional(),
  mcp: z.array(McpDaEtapa).optional(),
  /** Skills do projeto ativadas nesta etapa (fatia 10). Devem existir em `skills` do projeto. */
  skills: z.array(z.string().min(1)).optional(),
});
export type AgenteDaEtapaConfig = z.infer<typeof AgenteDaEtapaConfig>;

export const EtapasConfig = z
  .object({
    spec: AgenteDaEtapaConfig.optional(),
    review: AgenteDaEtapaConfig.optional(),
    implementacao: AgenteDaEtapaConfig.optional(),
    retro: AgenteDaEtapaConfig.optional(),
  })
  .strict();
export type EtapasConfig = z.infer<typeof EtapasConfig>;

/** Servidor MCP do projeto, iniciado por comando local em stdio (fatia 09). */
export const ServidorMcp = z.object({
  nome: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "use minúsculas, números e hífen (2 a 64 caracteres)"),
  comando: z.string().min(1),
  argumentos: z.array(z.string()).default([]),
});
export type ServidorMcp = z.infer<typeof ServidorMcp>;

/** Skill do projeto: bloco de instruções que uma etapa pode ativar (fatia 10). */
export const SkillDoProjeto = z.object({
  nome: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "use minúsculas, números e hífen (2 a 64 caracteres)"),
  descricao: z.string().optional(),
  conteudo: z.string().min(1),
});
export type SkillDoProjeto = z.infer<typeof SkillDoProjeto>;
