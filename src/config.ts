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
  /** Família explícita para modelos cujo nome não identifica a linhagem (ex.: aliases privados). */
  family: z.string().min(1).optional(),
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

/**
 * Formatador do repositório (ex.: `[npx, biome, check, --write]`): a fábrica o roda depois de cada ticket e commita o
 * resultado como estilo. Formatação é mecânica e toca testes; não cabe num ciclo TDD.
 */
export const FormatCommand = z.object({
  command: z.array(z.string().min(1)).min(1),
  timeoutSeconds: z.number().int().positive().default(120),
});
export type FormatCommand = z.infer<typeof FormatCommand>;

/** Cards cujo título ou chave começa com `prefix` vão para `path`. */
export const RepoMapping = z
  .object({
    /** Cópia local do repositório. A fábrica só lê dela; trabalha num clone próprio. */
    path: z.string().min(1),
    prefix: z.string().min(1),
    test: TestCommand,
    format: FormatCommand.optional(),
  })
  .strict();
export type RepoMapping = z.infer<typeof RepoMapping>;

/** Sobrescritas das convenções descobertas no histórico. Marcadores: `{key}`, `{slug}`, `{type}`, `{summary}`. */
export const ConventionsConfig = z.object({
  branch: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
});
export type ConventionsConfig = z.infer<typeof ConventionsConfig>;

/** Uma das pessoas do projeto: as únicas com quem a fábrica conversa neste projeto. */
/** Perfil do projeto, com nome livre (fatia 06). O papel diz o que ele recebe no roteamento (fatia 07). */
export const Profile = z.object({
  nome: z.string().min(1).max(60),
  papel: z.enum(["po", "tech_lead", "outro"]).default("outro"),
});
export type Profile = z.infer<typeof Profile>;

export const Person = z.object({
  /** Identificador da pessoa na Fonte do projeto (no Jira, o accountId), usado na menção e para reconhecer as respostas. */
  id: z.string().min(1),
  /** Forma antiga do perfil (po ou tech lead). Mantida para as configurações do YAML; novos projetos usam `perfis`. */
  role: z.enum(["po", "tech_lead"]).optional(),
  /** Perfis que a pessoa ocupa, pelo nome cadastrado em `profiles`. Uma pessoa pode ter vários (fatia 07). */
  perfis: z.array(z.string().min(1)).optional(),
  /** Nome para exibição, opcional. */
  name: z.string().min(1).optional(),
  /** Identificador da pessoa em cada integração (fatia 06): a Fonte e o canal consultam só o que lhes cabe. */
  identidades: z
    .object({
      jira: z.string().min(1).optional(),
      github: z.string().min(1).optional(),
      gitlab: z.string().min(1).optional(),
      teams: z
        .string()
        .regex(/^8:orgid:[a-zA-Z0-9-]+$/)
        .optional(),
    })
    .optional(),
  /** Canal da pessoa (fatia 08): `teams` acrescenta o aviso no Teams; ausente segue o padrão (ver canalDaPessoa). */
  canal: z.enum(["card-comment", "teams"]).optional(),
  /** Identificador do usuário no Teams, quando houver aviso pelo MCP (forma antiga; ver `identidades.teams`). */
  teamsUserId: z
    .string()
    .regex(/^8:orgid:[a-zA-Z0-9-]+$/)
    .optional(),
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
    /** Inclui feriados legais BR/SP/Mogi; obrigatório implicitamente para activity: business-hours. */
    legalHolidays: z.boolean().optional(),
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

const JiraSourceConfig = z.object({
  type: z.literal("jira"),
  /** Chave do projeto na Fonte (ex.: "PROJ"). */
  project: z.string().min(1),
  /** Identificador do usuário na Fonte; a fábrica só trabalha nos cards dele. */
  assignee: z.string().min(1),
  /** Restrição opcional da busca a cards específicos; use estado novo para ensaios isolados. */
  keys: z.array(z.string().min(1)).min(1).optional(),
  /** E-mail da conta Atlassian usada com a credencial (autenticação básica). */
  email: z.string().email().optional(),
  /** Nome da credencial no cofre da fábrica (token da API), sem o valor (ADR-0018). */
  credential: z.string().min(1).optional(),
  /** Origem HTTPS do Jira: link no aviso ao PO e download dos anexos. */
  baseUrl: z
    .string()
    .url()
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return (
        url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
      );
    }, "use a origem HTTPS do Jira")
    .optional(),
});

/** Repositório GitHub monitorado: toda issue aberta é candidata (ADR-0014). */
const GitHubSourceConfig = z.object({
  type: z.literal("github"),
  /** Prefixo das chaves dos cards (ex.: "SF" → "SF-12"). */
  project: z.string().min(1),
  /** Repositório "dono/nome". */
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "use dono/nome"),
  /** Login do dono no GitHub; a fábrica age com a conta dele. */
  assignee: z.string().min(1),
  keys: z.array(z.string().min(1)).min(1).optional(),
  baseUrl: z.undefined().optional(),
  /** Nome da credencial no cofre (token do GitHub), sem o valor (ADR-0018). */
  credential: z.string().min(1).optional(),
  /** Toda recusa da triagem passa por prévia na página local antes de comentar e fechar a issue. */
  triageApproval: z.boolean().default(true),
  /** Quantas issues deste repositório a fábrica toca ao mesmo tempo (Tarefas não terminadas). */
  maxActive: z.number().int().positive().default(1),
  /** Issues com algum destes labels ficam fora da fila; issues com sub-issues (épicos) também. */
  ignoreLabels: z.array(z.string().min(1)).default(["epic"]),
});

/** Projeto do GitLab monitorado (fatia 05): issues abertas atribuídas ao usuário, com o status por label `fabrica:`. */
const GitLabSourceConfig = z.object({
  type: z.literal("gitlab"),
  /** Prefixo das chaves dos cards (ex.: "GL" → "GL-12"). */
  project: z.string().min(1),
  /** Projeto no GitLab, como caminho completo (ex.: "grupo/projeto"). */
  repo: z.string().regex(/^[\w.-]+(\/[\w.-]+)+$/, "use grupo/projeto"),
  /** Usuário do GitLab dono das issues; a fábrica age com a conta dele. */
  assignee: z.string().min(1),
  keys: z.array(z.string().min(1)).min(1).optional(),
  /** A origem vem de `hostname`; `baseUrl` não se aplica ao GitLab. */
  baseUrl: z.undefined().optional(),
  /** Nome da credencial no cofre (token do GitLab), sem o valor (ADR-0018). */
  credential: z.string().min(1).optional(),
  /** Servidor quando não é gitlab.com (self-hosted), como nome de host (ex.: "gitlab.empresa.com"). */
  hostname: z
    .string()
    .regex(/^[a-z0-9.-]+(:\d+)?$/i, "use só o nome do host, sem https://")
    .optional(),
  /** Issues com algum destes labels ficam fora da fila; épicos também (padrão: `epic`). */
  ignoreLabels: z.array(z.string().min(1)).default(["epic"]),
});

export const ProjectConfig = z.object({
  name: z.string().min(1),
  /** Execução e avisos automáticos: sempre (pessoal) ou somente no calendário do projeto (empresa). */
  activity: z.enum(["always", "business-hours"]).default("always"),
  /** No dry-run a fábrica lê a Fonte de verdade, mas só registra as escritas. Ligado por padrão. */
  dryRun: z.boolean().default(true),
  /** No ensaio, segura a pergunta para aprovação e não publica uma SPEC sem pergunta. */
  questionApproval: z.boolean().default(false),
  /** Segura SPEC e Tickets até a aprovação da prévia exata na página local. */
  specApproval: z.boolean().default(false),
  /** Pausa a Tarefa depois da retrô de cada etapa (SPEC, implementação) até o usuário retomá-la. */
  retroApproval: z.boolean().default(false),
  /** Comenta "Assumindo este card." ao assumir. Desligue quando o card atribuído ao usuário já basta como sinal. */
  announceAssume: z.boolean().default(true),
  source: z.discriminatedUnion("type", [JiraSourceConfig, GitHubSourceConfig, GitLabSourceConfig]),
  /** Modelo fixado para cada Papel. A seleção por regras, com candidatos e allowlist, vem depois (M1-16). */
  roles: z.object({
    /** Grill, SPEC e Tickets. */
    spec: ModelRef,
    /** Triagem das issues de repositório monitorado. Sem ele, usa o modelo de `spec`. */
    triage: ModelRef.optional(),
    /** Implementação com TDD. Sem ele, usa o modelo de `spec`. */
    implementer: ModelRef.optional(),
    /** Review obrigatório antes da publicação; família diferente da implementação, sem fallback. */
    reviewer: ModelRef.optional(),
    /** Retrô de cada etapa e consolidada. Sem ele, usa o modelo de `spec`. */
    retro: ModelRef.optional(),
  }),
  /** Pessoas do projeto. A fábrica só menciona e pergunta a quem está aqui; perguntas de negócio vão ao `po`. */
  people: z.array(Person).default([]),
  /** Perfis do projeto, com nome livre (fatia 06). Quem não tem perfil nenhum usa só a forma antiga (`role`). */
  profiles: z.array(Profile).default([]),
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
  /** Prefixo de título/chave → repositório. Sem nenhum, a Tarefa termina depois dos Tickets. */
  repositories: z.array(RepoMapping).optional(),
  /** Sobrescritas de convenção de branch e commit. */
  conventions: ConventionsConfig.optional(),
  /** Mensagens deste projeto no Telegram. Sem o bloco, `content: full`. */
  telegram: z.object({ content: TelegramContent.default("full") }).optional(),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;

/** Ordem dos estados no workflow, do início ao fim. */
export const STATE_ORDER: readonly CardState[] = CardState.options;
