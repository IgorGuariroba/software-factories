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

/** Padrões (glob) que identificam arquivos de teste quando a config não diz outros. */
export const DEFAULT_TEST_FILES = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/*_test.*",
  "**/test_*.*",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
];

/** Como a fábrica roda os testes de um repositório: argv fixo, sem shell e sem argumentos do modelo. */
export const TestCommand = z.object({
  /** Programa e argumentos (ex.: `[npm, test]`). Nunca passa por um shell. */
  command: z.array(z.string().min(1)).min(1),
  /** Tempo máximo de uma execução, em segundos. */
  timeoutSeconds: z.number().int().positive().default(300),
  /** Padrões (glob, relativos à raiz do repositório) dos arquivos de teste. */
  files: z.array(z.string().min(1)).min(1).default(DEFAULT_TEST_FILES),
});
export type TestCommand = z.infer<typeof TestCommand>;

/** Cards cujo título começa com `prefix`, cuja chave começa com `prefix` ou que estão no `board` vão para `path`. */
export const RepoMapping = z
  .object({
    /** Cópia local do repositório. A fábrica só lê dela; trabalha num clone próprio. */
    path: z.string().min(1),
    prefix: z.string().min(1).optional(),
    board: z.string().min(1).optional(),
    test: TestCommand,
  })
  .refine((m) => m.prefix !== undefined || m.board !== undefined, { message: "informe prefix ou board" });
export type RepoMapping = z.infer<typeof RepoMapping>;

/** Sobrescritas das convenções descobertas no histórico. Marcadores: `{key}`, `{slug}`, `{type}`, `{summary}`. */
export const ConventionsConfig = z.object({
  branch: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
});
export type ConventionsConfig = z.infer<typeof ConventionsConfig>;

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
    /** Implementação com TDD. Sem ele, usa o modelo de `spec`. */
    implementer: ModelRef.optional(),
  }),
  /** Nome do status na Fonte → estado que a fábrica entende. */
  statuses: z.record(z.string(), CardState),
  /** Prefixo de título/chave ou board → repositório. Sem nenhum, a Tarefa termina depois dos Tickets. */
  repositories: z.array(RepoMapping).optional(),
  /** Sobrescritas de convenção de branch e commit. */
  conventions: ConventionsConfig.optional(),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;

/** Ordem dos estados no workflow, do início ao fim. */
export const STATE_ORDER: readonly CardState[] = CardState.options;
