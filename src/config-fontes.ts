import { z } from "zod";

export const JiraSourceConfig = z.object({
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
export const GitHubSourceConfig = z.object({
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
export const GitLabSourceConfig = z.object({
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
