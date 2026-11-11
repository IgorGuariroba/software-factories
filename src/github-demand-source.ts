import { execFile } from "node:child_process";
import type {
  Card,
  CardComment,
  DemandSource,
  IssueSnapshot,
  LinkedPullRequest,
  TextAttachment,
} from "./demand-source.js";
import { CAMPO_CREDENCIAL, CAMPO_LABELS_IGNORADAS } from "./fonte-campos.js";
import {
  CLOSED_STATUS,
  chaveDoCard,
  mencaoDePessoa,
  OPEN_STATUS,
  STATUS_LABEL,
  statusDoCard,
  temRotuloIgnorado,
} from "./packages/fonte-demanda/index.js";

export interface GhExecResult {
  stdout: string;
  stderr: string;
  exitCode?: number;
}

/** Runner injetável para o `gh`. Permite testes sem o binário real. */
export type GhRunner = (args: string[], input?: string, env?: Record<string, string>) => Promise<GhExecResult>;

export const defaultGhRunner: GhRunner = (args, input, env) =>
  new Promise((resolve) => {
    // Um `gh` travado não pode segurar o polling: depois do limite o processo é morto e a chamada falha.
    const child = execFile(
      "gh",
      args,
      { maxBuffer: 64 * 1024 * 1024, timeout: 60_000, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 0;
        resolve({
          stdout: String(stdout),
          stderr: String(stderr || (error && !code ? error.message : "")),
          exitCode: error ? code || 1 : 0,
        });
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });

export interface GitHubDemandSourceOptions {
  /** Prefixo das chaves dos cards (ex.: "SF" → "SF-12"). */
  project: string;
  /** Repositório "dono/nome". */
  repo: string;
  /** Login do dono: toda issue aberta é tratada como dele. */
  assignee: string;
  /** Issues com algum destes labels ficam fora da fila (padrão: `epic`). */
  ignoreLabels?: string[];
  runner?: GhRunner;
  /** Token do GitHub vindo do cofre (ADR-0018); vai ao `gh` pela variável `GH_TOKEN`. */
  token?: () => Promise<string | undefined>;
}

/** Prefixo dos labels de status da fábrica. */
export { CLOSED_STATUS, OPEN_STATUS, STATUS_LABEL } from "./packages/fonte-demanda/index.js";

/** Issue como a API do GitHub a devolve (e como o webhook `issues` a envia). */
export interface RawIssue {
  /** Id numérico estável da issue no GitHub (ADR-0015, Fase 3): a identidade da importação. */
  id?: number;
  number: number;
  title: string;
  body?: string | null;
  state: string;
  labels?: (string | { name?: string })[];
  pull_request?: unknown;
  /** Resumo das sub-issues: uma issue com sub-issues é um épico. */
  sub_issues_summary?: { total?: number } | null;
}

interface RawTimelineEvent {
  event?: string;
  source?: {
    issue?: {
      number: number;
      state: string;
      pull_request?: { merged_at?: string | null } | null;
      repository?: { full_name?: string };
    };
  };
}

interface RawComment {
  id: number;
  body?: string | null;
  user?: { login?: string } | null;
}

export function labelNames(issue: RawIssue): string[] {
  return (issue.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? "")));
}

/**
 * Card da Fonte a partir de uma issue. Fonte única da regra de status (label `fabrica:<status>`, ou `aberta`/`fechada`),
 * usada também pelo webhook.
 */
export function cardOfIssue(opts: { project: string; assignee: string }, issue: RawIssue): Card {
  return {
    key: chaveDoCard(opts.project, issue.number),
    title: issue.title,
    status: statusDoCard({ fechada: issue.state === "closed", rotulos: labelNames(issue) }),
    assignee: opts.assignee,
    description: issue.body ?? "",
  };
}

export class GitHubDemandSource implements DemandSource {
  private readonly run: GhRunner;

  constructor(private readonly opts: GitHubDemandSourceOptions) {
    const base = opts.runner ?? defaultGhRunner;
    const { token } = opts;
    this.run = token
      ? async (args, input) => {
          const valor = await token();
          return base(args, input, valor ? { GH_TOKEN: valor } : undefined);
        }
      : base;
  }

  private numberOf(key: string): number | undefined {
    const m = new RegExp(`^${this.opts.project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`).exec(key);
    return m ? Number(m[1]) : undefined;
  }

  private async api(args: string[], what: string, input?: object): Promise<string> {
    const res = await this.run(["api", ...args, ...(input ? ["--input", "-"] : [])], input && JSON.stringify(input));
    if ((res.exitCode ?? 0) !== 0)
      throw new Error(`gh api ${what} falhou: ${res.stderr.trim() || `código ${res.exitCode}`}`);
    return res.stdout;
  }

  /** `gh api --paginate --slurp` devolve uma lista de páginas. */
  private async list<T>(path: string, what: string): Promise<T[]> {
    const stdout = await this.api(["--paginate", "--slurp", path], what);
    const pages: unknown = JSON.parse(stdout || "[]");
    if (!Array.isArray(pages)) throw new Error(`gh api ${what}: resposta inesperada`);
    return pages.flatMap((p) => (Array.isArray(p) ? (p as T[]) : [p as T]));
  }

  private toCard(issue: RawIssue): Card {
    return cardOfIssue(this.opts, issue);
  }

  async listAssignedCards(assignee: string): Promise<Card[]> {
    if (assignee !== this.opts.assignee) return [];
    const issues = await this.list<RawIssue>(`repos/${this.opts.repo}/issues?state=open&per_page=100`, "issues");
    // Épicos (com sub-issues ou com um label ignorado) ficam fora: o trabalho está nas sub-issues, cada uma na fila.
    return issues
      .filter((i) => !i.pull_request)
      .filter((i) => !(i.sub_issues_summary?.total ?? 0))
      .filter((i) => !temRotuloIgnorado(labelNames(i), this.opts.ignoreLabels))
      .map((i) => this.toCard(i));
  }

  async getCard(key: string): Promise<Card | undefined> {
    const n = this.numberOf(key);
    if (n === undefined) return undefined;
    const res = await this.run(["api", `repos/${this.opts.repo}/issues/${n}`]);
    if ((res.exitCode ?? 0) !== 0) {
      if (/HTTP 404|Not Found/i.test(res.stderr)) return undefined;
      throw new Error(`gh api issue ${key} falhou: ${res.stderr.trim() || `código ${res.exitCode}`}`);
    }
    const issue = JSON.parse(res.stdout) as RawIssue;
    return issue.pull_request ? undefined : this.toCard(issue);
  }

  async listComments(key: string): Promise<CardComment[]> {
    const n = this.numberOf(key);
    if (n === undefined) return [];
    const raw = await this.list<RawComment>(
      `repos/${this.opts.repo}/issues/${n}/comments?per_page=100`,
      `comentários de ${key}`,
    );
    return raw.map((c) => ({ id: String(c.id), author: this.person(c.user?.login ?? ""), body: c.body ?? "" }));
  }

  /** Issues do GitHub não têm anexos como o Jira; a leitura ainda confere a issue, para falha não virar lista vazia. */
  async listTextAttachments(key: string): Promise<TextAttachment[]> {
    if (this.numberOf(key) !== undefined) await this.getCard(key);
    return [];
  }

  /** Login do GitHub não diferencia caixa: o dono volta exatamente como configurado. */
  private person(login: string): string {
    return login.toLowerCase() === this.opts.assignee.toLowerCase() ? this.opts.assignee : login;
  }

  /** Confere antes de cada escrita, sem cache: se a conta ativa do `gh` mudar, a escrita seguinte é recusada. */
  private async assertOwner(): Promise<void> {
    const login = (JSON.parse(await this.api(["user"], "conta autenticada")) as { login: string }).login;
    if (login.toLowerCase() !== this.opts.assignee.toLowerCase())
      throw new Error(`o gh está autenticado como ${login}, não como ${this.opts.assignee}: escrita recusada`);
  }

  private issueNumber(key: string): number {
    const n = this.numberOf(key);
    if (n === undefined) throw new Error(`card ${key} não pertence ao projeto ${this.opts.project}`);
    return n;
  }

  async addComment(key: string, body: string): Promise<{ id: string }> {
    const n = this.issueNumber(key);
    await this.assertOwner();
    const out = await this.api(["-X", "POST", `repos/${this.opts.repo}/issues/${n}/comments`], `comentar em ${key}`, {
      body,
    });
    return { id: String((JSON.parse(out) as { id: number }).id) };
  }

  async editComment(key: string, commentId: string, body: string): Promise<void> {
    this.issueNumber(key);
    await this.assertOwner();
    await this.api(
      ["-X", "PATCH", `repos/${this.opts.repo}/issues/comments/${commentId}`],
      `editar comentário de ${key}`,
      { body },
    );
  }

  async transition(key: string, status: string): Promise<void> {
    const n = this.issueNumber(key);
    await this.assertOwner();
    const path = `repos/${this.opts.repo}/issues/${n}`;
    const issue = JSON.parse(await this.api([path], `issue ${key}`)) as RawIssue;
    const target = status.toLowerCase();
    const wanted = target === OPEN_STATUS || target === CLOSED_STATUS ? undefined : `${STATUS_LABEL}${target}`;
    // Só os labels da fábrica mudam, um a um: labels postos por outras pessoas no meio do caminho ficam intactos.
    for (const label of labelNames(issue).filter((l) => l.startsWith(STATUS_LABEL) && l !== wanted))
      await this.removeLabel(path, label, key);
    if (wanted && !labelNames(issue).includes(wanted))
      await this.api(["-X", "POST", `${path}/labels`], `pôr ${wanted} em ${key}`, { labels: [wanted] });
    const state = target === CLOSED_STATUS ? "closed" : "open";
    if (issue.state !== state) await this.api(["-X", "PATCH", path], `mudar estado de ${key}`, { state });
  }

  /** Um 404 só é aceito se o label já não está na issue (outra pessoa o tirou); qualquer outro erro sobe. */
  private async removeLabel(path: string, label: string, key: string): Promise<void> {
    const res = await this.run(["api", "-X", "DELETE", `${path}/labels/${encodeURIComponent(label)}`]);
    if ((res.exitCode ?? 0) === 0) return;
    if (/HTTP 404/.test(res.stderr)) {
      const now = JSON.parse(await this.api([path], `issue ${key}`)) as RawIssue;
      if (!labelNames(now).includes(label)) return;
    }
    throw new Error(`gh api tirar ${label} de ${key} falhou: ${res.stderr.trim() || `código ${res.exitCode}`}`);
  }

  /** PRs deste repositório que citam a issue (eventos `cross-referenced` da timeline). */
  async linkedPullRequests(key: string): Promise<LinkedPullRequest[]> {
    const n = this.issueNumber(key);
    const events = await this.list<RawTimelineEvent>(
      `repos/${this.opts.repo}/issues/${n}/timeline?per_page=100`,
      `timeline de ${key}`,
    );
    const prs = new Map<number, LinkedPullRequest>();
    for (const e of events) {
      const ref = e.event === "cross-referenced" ? e.source?.issue : undefined;
      if (!ref?.pull_request || ref.repository?.full_name?.toLowerCase() !== this.opts.repo.toLowerCase()) continue;
      const state = ref.pull_request.merged_at ? "merged" : ref.state === "open" ? "open" : "closed";
      prs.set(ref.number, { number: ref.number, state });
    }
    return [...prs.values()];
  }

  /** Baixa da triagem: tira os labels da fábrica e fecha a issue com o motivo. */
  async dismiss(key: string, reason: "completed" | "not_planned" | "duplicate"): Promise<void> {
    const n = this.issueNumber(key);
    await this.assertOwner();
    const path = `repos/${this.opts.repo}/issues/${n}`;
    const issue = JSON.parse(await this.api([path], `issue ${key}`)) as RawIssue;
    for (const label of labelNames(issue).filter((l) => l.startsWith(STATUS_LABEL)))
      await this.removeLabel(path, label, key);
    if (issue.state !== "closed")
      await this.api(["-X", "PATCH", path], `fechar ${key}`, { state: "closed", state_reason: reason });
  }

  /** Issues do repositório alteradas desde `since`, abertas ou fechadas, numa paginação só. */
  async listChangedSince(since: string): Promise<IssueSnapshot[]> {
    const raw = await this.list<RawIssue & { updated_at?: string }>(
      `repos/${this.opts.repo}/issues?state=all&since=${encodeURIComponent(since)}&per_page=100`,
      "issues alteradas",
    );
    return raw.map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body ?? null,
      state: i.state === "closed" ? "closed" : "open",
      labels: labelNames(i),
      subIssues: i.sub_issues_summary?.total ?? 0,
      pullRequest: Boolean(i.pull_request),
      updatedAt: i.updated_at ?? new Date(0).toISOString(),
    }));
  }

  formatMention(personId: string): string {
    return mencaoDePessoa(personId);
  }
}

export function createGitHubDemandSource(opts: GitHubDemandSourceOptions): DemandSource {
  return new GitHubDemandSource(opts);
}

/** Schema de configuração desta Fonte: a interface gera o formulário a partir dele (fatia 04). */
export const ESQUEMA_FONTE = {
  tipo: "github",
  rotulo: "GitHub Issues",
  campos: [
    { campo: "project", rotulo: "Prefixo das chaves", tipo: "texto", obrigatorio: true },
    { campo: "repo", rotulo: "Repositório (dono/nome)", tipo: "texto", obrigatorio: true },
    { campo: "assignee", rotulo: "Dono das issues", tipo: "texto", obrigatorio: true },
    CAMPO_CREDENCIAL,
    CAMPO_LABELS_IGNORADAS,
  ],
};
