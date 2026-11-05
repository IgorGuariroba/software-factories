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

/** Uma das pessoas do projeto: as únicas com quem a fábrica conversa neste projeto. */
export const Person = z.object({
  /** Identificador da pessoa na Fonte (no Jira, o accountId), usado na menção e para reconhecer as respostas. */
  id: z.string().min(1),
  role: z.enum(["po", "tech_lead"]),
  /** Nome para exibição, opcional. */
  name: z.string().min(1).optional(),
});
export type Person = z.infer<typeof Person>;

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const HourMinute = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM, de 00:00 a 23:59");

/** Dias da semana, na ordem de `Date.getUTCDay()`. */
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Expediente do projeto: os prazos das perguntas (lembrete, aviso) contam só horas dentro dele. */
export const BusinessCalendar = z
  .object({
    /** Fuso IANA do expediente (ex.: America/Sao_Paulo). */
    timezone: z.string().refine(isTimeZone, { message: "fuso horário IANA desconhecido" }).default("UTC"),
    workdays: z.array(z.enum(WEEKDAYS)).min(1).default(["mon", "tue", "wed", "thu", "fri"]),
    /** Início e fim do expediente, no fuso do calendário. */
    start: HourMinute.default("09:00"),
    end: HourMinute.default("18:00"),
    /** Datas sem expediente (feriados), como AAAA-MM-DD no fuso do calendário. */
    holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD")).default([]),
  })
  .refine((c) => c.start < c.end, { message: "start precisa ser antes de end", path: ["end"] });
export type BusinessCalendar = z.infer<typeof BusinessCalendar>;

/**
 * Quanto do conteúdo do projeto vai nas mensagens ao Telegram (ADR-0009). Toda mensagem passa pelo filtro de segredos.
 * - `full`: o texto completo (títulos de card, avisos, motivos de bloqueio);
 * - `minimal`: só o tipo do evento, o card, o projeto e prazos; nada escrito por pessoas ou modelos.
 */
export const TelegramContent = z.enum(["full", "minimal"]);
export type TelegramContent = z.infer<typeof TelegramContent>;

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
  /** Pessoas do projeto. A fábrica só menciona e pergunta a quem está aqui; perguntas de negócio vão ao `po`. */
  people: z.array(Person).default([]),
  /** Calendário de horas úteis dos prazos das perguntas. Padrão: segunda a sexta, 09:00–18:00, UTC. */
  calendar: BusinessCalendar.default({
    timezone: "UTC",
    workdays: ["mon", "tue", "wed", "thu", "fri"],
    start: "09:00",
    end: "18:00",
    holidays: [],
  }),
  /**
   * Prazo, em minutos no relógio da fábrica, para o usuário vetar a Tarefa de um card que já estava em andamento antes
   * de a fábrica continuá-lo.
   */
  vetoMinutes: z.number().int().positive().default(30),
  /** Nome do status na Fonte → estado que a fábrica entende. */
  statuses: z.record(z.string(), CardState),
  /** Prefixo de título/chave ou board → repositório. Sem nenhum, a Tarefa termina depois dos Tickets. */
  repositories: z.array(RepoMapping).optional(),
  /** Sobrescritas de convenção de branch e commit. */
  conventions: ConventionsConfig.optional(),
  /** Mensagens deste projeto no Telegram. Sem o bloco, `content: full`. */
  telegram: z.object({ content: TelegramContent.default("full") }).optional(),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;

/** Ordem dos estados no workflow, do início ao fim. */
export const STATE_ORDER: readonly CardState[] = CardState.options;
