import { execFile } from "node:child_process";
import type { Card, CardComment, DemandSource, TextAttachment } from "./demand-source.js";
import { CAMPO_CREDENCIAL, CAMPO_LABELS_IGNORADAS } from "./fonte-campos.js";
import {
  CLOSED_STATUS,
  chaveDoCard,
  mencaoDePessoa,
  OPEN_STATUS,
  STATUS_LABEL,
  statusDoCard,
} from "./packages/fonte-demanda/index.js";
import { redactSecrets } from "./secrets.js";

export interface GlabExecResult {
  stdout: string;
  stderr: string;
  exitCode?: number;
}

/** Runner injetável para o `glab`. Permite testes sem o binário real. */
export type GlabRunner = (args: string[], input?: string, env?: Record<string, string>) => Promise<GlabExecResult>;

export const defaultGlabRunner: GlabRunner = (args, input, env) =>
  new Promise((resolve) => {
    // Um `glab` travado não pode segurar o polling: depois do limite o processo é morto e a chamada falha.
    const child = execFile(
      "glab",
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

export interface GitLabDemandSourceOptions {
  /** Prefixo das chaves dos cards (ex.: "GL" → "GL-12"). */
  project: string;
  /** Projeto no GitLab, como caminho completo (ex.: "grupo/projeto"). */
  repo: string;
  /** Usuário do GitLab dono das issues: toda issue aberta atribuída a ele é um card. */
  assignee: string;
  /** Servidor, quando não é gitlab.com (self-hosted). */
  hostname?: string;
  /** Issues com algum destes labels ficam fora da fila (padrão: `epic`). */
  ignoreLabels?: string[];
  runner?: GlabRunner;
  /** Token do GitLab vindo do cofre (ADR-0018); vai ao `glab` pela variável `GITLAB_TOKEN`. */
  token?: () => Promise<string | undefined>;
}

/** Prefixo dos labels de status da fábrica, igual ao da Fonte GitHub (ADR-0014). */
export { CLOSED_STATUS, OPEN_STATUS, STATUS_LABEL } from "./packages/fonte-demanda/index.js";

const PAGE_SIZE = 100;

interface RawIssue {
  iid: number;
  title: string;
  description?: string | null;
  state: string;
  labels?: string[];
  author?: { username?: string };
}

interface RawNote {
  id: number;
  body?: string | null;
  author?: { username?: string };
  system?: boolean;
}

/**
 * Fonte GitLab Issues via `glab api`. Cada issue aberta atribuída ao usuário é um card; o status vem do label
 * `fabrica:<status>` (sem label, `aberta`; issue fechada, `fechada`), igual à Fonte GitHub.
 */
export class GitLabDemandSource implements DemandSource {
  private readonly runner: GlabRunner;
  private readonly ignoreLabels: string[];
  private readonly repoPath: string;

  constructor(private readonly opts: GitLabDemandSourceOptions) {
    this.runner = opts.runner ?? defaultGlabRunner;
    this.ignoreLabels = opts.ignoreLabels ?? ["epic"];
    this.repoPath = encodeURIComponent(opts.repo);
  }

  private async api<T>(caminho: string, metodo = "GET", campos: Record<string, string> = {}): Promise<T> {
    const args = ["api", caminho, "--method", metodo];
    for (const [chave, valor] of Object.entries(campos)) args.push("-f", `${chave}=${valor}`);
    if (this.opts.hostname) args.push("--hostname", this.opts.hostname);
    const token = this.opts.token ? await this.opts.token() : undefined;
    const res = await this.runner(args, undefined, token ? { GITLAB_TOKEN: token } : undefined);
    if (res.exitCode) throw new Error(redactSecrets(`glab falhou: ${res.stderr.trim()}`));
    return (res.stdout.trim() ? JSON.parse(res.stdout) : undefined) as T;
  }

  /** Todas as páginas de um endpoint de lista. */
  private async paginate<T>(caminho: string): Promise<T[]> {
    const todas: T[] = [];
    for (let pagina = 1; ; pagina++) {
      const sep = caminho.includes("?") ? "&" : "?";
      const lote = await this.api<T[]>(`${caminho}${sep}per_page=${PAGE_SIZE}&page=${pagina}`);
      todas.push(...lote);
      if (lote.length < PAGE_SIZE) return todas;
    }
  }

  private keyOf(iid: number): string {
    return chaveDoCard(this.opts.project, iid);
  }

  /** O número da issue de um card deste projeto; `undefined` para um card de outro projeto. */
  private iidOf(key: string): number | undefined {
    const prefixo = `${this.opts.project}-`;
    if (!key.startsWith(prefixo)) return undefined;
    const iid = Number(key.slice(prefixo.length));
    return Number.isInteger(iid) && iid > 0 ? iid : undefined;
  }

  /** O número da issue, ou erro para escrita num card de outro projeto. */
  private iidOuFalha(key: string): number {
    const iid = this.iidOf(key);
    if (iid === undefined) throw new Error(`card ${key} não pertence ao projeto ${this.opts.project}`);
    return iid;
  }

  private statusOf(issue: RawIssue): string {
    return statusDoCard({ fechada: issue.state === "closed", rotulos: issue.labels ?? [] });
  }

  private toCard(issue: RawIssue): Card {
    return {
      key: this.keyOf(issue.iid),
      title: issue.title,
      status: this.statusOf(issue),
      assignee: this.opts.assignee,
      description: issue.description ?? undefined,
    };
  }

  async listAssignedCards(assignee: string): Promise<Card[]> {
    const issues = await this.paginate<RawIssue>(
      `projects/${this.repoPath}/issues?state=opened&assignee_username=${encodeURIComponent(assignee)}`,
    );
    return issues
      .filter((i) => !(i.labels ?? []).some((l) => this.ignoreLabels.includes(l)))
      .map((i) => this.toCard(i));
  }

  async getCard(key: string): Promise<Card | undefined> {
    const iid = this.iidOf(key);
    if (iid === undefined) return undefined;
    try {
      return this.toCard(await this.api<RawIssue>(`projects/${this.repoPath}/issues/${iid}`));
    } catch (err) {
      if (err instanceof Error && /404/.test(err.message)) return undefined;
      throw err;
    }
  }

  async listComments(key: string): Promise<CardComment[]> {
    const iid = this.iidOf(key);
    if (iid === undefined) return [];
    const notas = await this.paginate<RawNote>(`projects/${this.repoPath}/issues/${iid}/notes`);
    return notas
      .filter((n) => !n.system)
      .map((n) => ({ id: String(n.id), author: n.author?.username ?? "", body: n.body ?? "" }));
  }

  /**
   * O GitLab entrega anexos como links no texto, e esta versão não os baixa: a lista é sempre vazia. A leitura da issue
   * continua acontecendo, para que uma falha da Fonte apareça como erro e não como anexo ausente.
   */
  async listTextAttachments(key: string): Promise<TextAttachment[]> {
    const iid = this.iidOf(key);
    if (iid === undefined) return [];
    await this.api(`projects/${this.repoPath}/issues/${iid}`);
    return [];
  }

  async addComment(key: string, body: string): Promise<{ id: string }> {
    const nota = await this.api<{ id: number }>(
      `projects/${this.repoPath}/issues/${this.iidOuFalha(key)}/notes`,
      "POST",
      {
        body,
      },
    );
    return { id: String(nota.id) };
  }

  async editComment(key: string, commentId: string, body: string): Promise<void> {
    await this.api(`projects/${this.repoPath}/issues/${this.iidOuFalha(key)}/notes/${commentId}`, "PUT", { body });
  }

  async transition(key: string, status: string): Promise<void> {
    const iid = this.iidOuFalha(key);
    const issue = await this.api<RawIssue>(`projects/${this.repoPath}/issues/${iid}`);
    const removidos = (issue.labels ?? []).filter((l) => l.startsWith(STATUS_LABEL));
    const campos: Record<string, string> = {};
    if (removidos.length > 0) campos.remove_labels = removidos.join(",");
    if (status === CLOSED_STATUS) {
      campos.state_event = "close";
    } else {
      if (issue.state === "closed") campos.state_event = "reopen";
      if (status !== OPEN_STATUS) campos.add_labels = `${STATUS_LABEL}${status}`;
    }
    await this.api(`projects/${this.repoPath}/issues/${iid}`, "PUT", campos);
  }

  formatMention(personId: string): string {
    return mencaoDePessoa(personId);
  }
}

export function createGitLabDemandSource(opts: GitLabDemandSourceOptions): DemandSource {
  return new GitLabDemandSource(opts);
}

/** Schema de configuração desta Fonte: a interface gera o formulário a partir dele (fatia 04). */
export const ESQUEMA_FONTE = {
  tipo: "gitlab",
  rotulo: "GitLab Issues",
  campos: [
    { campo: "project", rotulo: "Prefixo das chaves", tipo: "texto", obrigatorio: true },
    { campo: "repo", rotulo: "Projeto (grupo/projeto)", tipo: "texto", obrigatorio: true },
    { campo: "assignee", rotulo: "Usuário dono das issues", tipo: "texto", obrigatorio: true },
    { campo: "hostname", rotulo: "Servidor (vazio para gitlab.com)", tipo: "texto", obrigatorio: false },
    CAMPO_CREDENCIAL,
    CAMPO_LABELS_IGNORADAS,
  ],
};
