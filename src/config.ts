import { z } from "zod";
import { EtapasConfig, ModelRef, ServidorMcp, SkillDoProjeto } from "./config-agentes.js";
import { BusinessCalendar } from "./config-calendario.js";
import { GitHubSourceConfig, GitLabSourceConfig, JiraSourceConfig } from "./config-fontes.js";
import { DISPONIVEIS_DA_ETAPA } from "./ferramentas-catalogo.js";

export * from "./config-agentes.js";
export * from "./config-calendario.js";
export * from "./config-fontes.js";

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
  /**
   * Programa e argumentos (ex.: `[npm, test]`). Nunca passa por um shell. Vazio quer dizer "ainda não informado": o
   * projeto fica incompleto até ter um comando (ticket 08, ADR-0022).
   */
  command: z.array(z.string().min(1)),
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
        .regex(/^8:orgid:[a-zA-Z0-9-]+$/, "use o identificador do Teams no formato 8:orgid:… (não o e-mail)")
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

/**
 * Quanto do conteúdo do projeto vai nas mensagens ao Telegram (ADR-0009). Toda mensagem passa pelo filtro de segredos.
 * - `full`: o texto completo (títulos de card, avisos, motivos de bloqueio);
 * - `minimal`: só o tipo do evento, o card, o projeto e prazos; nada escrito por pessoas ou modelos.
 */
export const TelegramContent = z.enum(["full", "minimal"]);
export type TelegramContent = z.infer<typeof TelegramContent>;

const ProjectConfigBase = z.object({
  name: z.string().min(1),
  /** Configuração de cada etapa (Agente da etapa). Ausente: padrão embutido para todas as etapas. */
  etapas: EtapasConfig.optional(),
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
  /**
   * Provedores de modelos que o projeto pode usar (ex.: `anthropic`). Sem nenhum, o projeto fica incompleto (ticket 08).
   */
  allowedProviders: z.array(z.string().min(1)).default([]),
  /** Sobrescritas de convenção de branch e commit. */
  conventions: ConventionsConfig.optional(),
  /** Mensagens deste projeto no Telegram. Sem o bloco, `content: full`. */
  telegram: z.object({ content: TelegramContent.default("full") }).optional(),
  /** Skills do projeto: blocos de instruções que cada etapa escolhe, pela interface. */
  skills: z.array(SkillDoProjeto).optional(),
  /** Servidores MCP cadastrados no projeto (fatia 09). Uma etapa só usa os que estão aqui. */
  mcpServers: z.array(ServidorMcp).optional(),
});

/** Uma etapa só pode ativar skills e servidores MCP que o projeto define. */
export const ProjectConfig = ProjectConfigBase.superRefine((config, ctx) => {
  const skills = new Set((config.skills ?? []).map((s) => s.nome));
  const servidores = new Set((config.mcpServers ?? []).map((s) => s.nome));
  for (const [etapa, bloco] of Object.entries(config.etapas ?? {})) {
    // Uma etapa só liga as ferramentas que ela implementa (ex.: escrita nunca na review).
    const disponiveis = DISPONIVEIS_DA_ETAPA[etapa as keyof typeof DISPONIVEIS_DA_ETAPA] as
      | readonly string[]
      | undefined;
    for (const nome of bloco?.ferramentas ?? []) {
      if (!disponiveis?.includes(nome))
        ctx.addIssue({
          code: "custom",
          path: ["etapas", etapa, "ferramentas"],
          message: `a etapa ${etapa} não implementa a ferramenta ${nome}`,
        });
    }
    for (const nome of bloco?.skills ?? []) {
      if (!skills.has(nome))
        ctx.addIssue({ code: "custom", path: ["etapas", etapa, "skills"], message: `skill inexistente: ${nome}` });
    }
    for (const { servidor } of bloco?.mcp ?? []) {
      if (!servidores.has(servidor))
        ctx.addIssue({
          code: "custom",
          path: ["etapas", etapa, "mcp"],
          message: `servidor MCP inexistente: ${servidor}`,
        });
    }
  }
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;

/** Ordem dos estados no workflow, do início ao fim. */
export const STATE_ORDER: readonly CardState[] = CardState.options;
