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

export const ProjectConfig = z.object({
  name: z.string().min(1),
  source: z.object({
    type: z.literal("jira"),
    /** Chave do projeto na Fonte (ex.: "PROJ"). */
    project: z.string().min(1),
    /** Identificador do usuário na Fonte; a fábrica só trabalha nos cards dele. */
    assignee: z.string().min(1),
  }),
  /** Nome do status na Fonte → estado que a fábrica entende. */
  statuses: z.record(z.string(), CardState),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;
