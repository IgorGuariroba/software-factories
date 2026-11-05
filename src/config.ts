import { z } from "zod";

/** Estados do workflow que a fábrica entende. */
export const CardState = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "waiting_test",
  "waiting_validation",
  "gmud",
  "done",
]);
export type CardState = z.infer<typeof CardState>;

/** Um modelo específico de um provedor (ex.: `{ provider: anthropic, model: claude-… }`). */
export const ModelRef = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});
export type ModelRef = z.infer<typeof ModelRef>;

export const ProjectConfig = z.object({
  name: z.string().min(1),
  /** No dry-run a fábrica lê a Fonte de verdade, mas só registra as escritas. Ligado por padrão. */
  dryRun: z.boolean().default(true),
  source: z.object({
    type: z.literal("jira"),
    /** Chave do projeto na Fonte (ex.: "PROJ"). */
    project: z.string().min(1),
    /** Identificador do usuário na Fonte; a fábrica só trabalha nos cards dele. */
    assignee: z.string().min(1),
  }),
  /** Modelo fixado para cada Papel. A seleção por regras, com candidatos e allowlist, vem depois (M1-16). */
  roles: z.object({
    /** Grill, SPEC e Tickets. */
    spec: ModelRef,
  }),
  /** Nome do status na Fonte → estado que a fábrica entende. */
  statuses: z.record(z.string(), CardState),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;

/** Ordem dos estados no workflow, do início ao fim. */
export const STATE_ORDER: readonly CardState[] = CardState.options;
