import type { GlabExecResult as GhExecResult, GlabRunner as GhRunner } from "../../src/gitlab-demand-source.js";

/** Issue como a API do GitLab a devolve, no que a fábrica usa. */
export interface FakeGitLabIssue {
  iid: number;
  title: string;
  description?: string;
  state?: "opened" | "closed";
  /** Labels sem o prefixo de status (ex.: "epic"); o status da fábrica fica em `fabrica:<status>`. */
  labels?: string[];
  author?: string;
  assignee?: string;
}

interface FakeNote {
  id: number;
  body: string;
  author: string;
}

const PAGE_SIZE = 100;

/**
 * `glab` falso: emula os endpoints de issues e notas da API do GitLab que o adaptador usa (`glab api <caminho>`), com
 * paginação por `page`/`per_page` e a resposta de erro do CLI quando a credencial falha.
 */
export class FakeGlabIssues {
  issues: FakeGitLabIssue[] = [];
  private readonly notas = new Map<number, FakeNote[]>();
  /** Se definido, toda chamada falha com esta mensagem no stderr, como um `glab` sem credencial. */
  failWith?: string;
  private nextNoteId = 1000;

  constructor(
    private readonly repo: string,
    private readonly user: string,
  ) {}

  addComment(iid: number, author: string, body: string): void {
    const issue = this.issues.find((i) => i.iid === iid);
    if (!issue) throw new Error(`issue ${iid} inexistente no fake`);
    this.notasDe(iid).push({ id: this.nextNoteId++, body, author });
  }

  /** Executa o `glab` falso. Só `glab api` é suportado. */
  runner: GhRunner = async (args, input): Promise<GhExecResult> => {
    if (this.failWith) return { stdout: "", stderr: this.failWith, exitCode: 1 };
    if (args[0] !== "api") return { stdout: "", stderr: `comando não suportado: ${args.join(" ")}`, exitCode: 1 };
    const path = args[1] ?? "";
    const method = flag(args, "-X") ?? flag(args, "--method") ?? "GET";
    const campos = fields(args);
    const url = new URL(`https://gitlab.invalid/${path}`);
    const repoPath = encodeURIComponent(this.repo);
    const base = `projects/${repoPath}/issues`;

    if (url.pathname === `/${base}` && method === "GET") {
      const pagina = Number(url.searchParams.get("page") ?? "1");
      const estado = url.searchParams.get("state") ?? "opened";
      const responsavel = url.searchParams.get("assignee_username");
      const filtradas = this.issues.filter(
        (i) => (estado === "all" || (i.state ?? "opened") === estado) && (!responsavel || i.assignee === responsavel),
      );
      return ok(filtradas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map((i) => this.issueJson(i)));
    }

    const issueMatch = url.pathname.match(new RegExp(`^/${base}/(\\d+)$`));
    if (issueMatch && method === "GET") {
      const issue = this.find(issueMatch[1]);
      return issue ? ok(this.issueJson(issue)) : notFound();
    }
    if (issueMatch && method === "PUT") {
      const issue = this.find(issueMatch[1]);
      if (!issue) return notFound();
      this.applyUpdate(issue, campos);
      return ok(this.issueJson(issue));
    }

    const notesMatch = url.pathname.match(new RegExp(`^/${base}/(\\d+)/notes$`));
    if (notesMatch && method === "GET") {
      const issue = this.find(notesMatch[1]);
      if (!issue) return notFound();
      const pagina = Number(url.searchParams.get("page") ?? "1");
      return ok(
        this.notasDe(issue.iid)
          .slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE)
          .map((n) => ({ id: n.id, body: n.body, author: { username: n.author }, system: false })),
      );
    }
    if (notesMatch && method === "POST") {
      const issue = this.find(notesMatch[1]);
      if (!issue) return notFound();
      const nota = { id: this.nextNoteId++, body: campos.body ?? "", author: this.user };
      this.notasDe(issue.iid).push(nota);
      return ok({ id: nota.id, body: nota.body });
    }

    const noteMatch = url.pathname.match(new RegExp(`^/${base}/(\\d+)/notes/(\\d+)$`));
    if (noteMatch && method === "PUT") {
      const issue = this.find(noteMatch[1]);
      const nota = issue && this.notasDe(issue.iid).find((n) => n.id === Number(noteMatch[2]));
      if (!nota) return notFound();
      nota.body = campos.body ?? nota.body;
      return ok({ id: nota.id, body: nota.body });
    }

    void input;
    return { stdout: "", stderr: `404 Not Found: ${path}`, exitCode: 1 };
  };

  private notasDe(iid: number): FakeNote[] {
    const existente = this.notas.get(iid);
    if (existente) return existente;
    const nova: FakeNote[] = [];
    this.notas.set(iid, nova);
    return nova;
  }

  private find(iid: string): FakeGitLabIssue | undefined {
    return this.issues.find((i) => i.iid === Number(iid));
  }

  private issueJson(i: FakeGitLabIssue) {
    return {
      iid: i.iid,
      title: i.title,
      description: i.description ?? null,
      state: i.state ?? "opened",
      labels: i.labels ?? [],
      author: { username: i.author ?? "autor" },
      assignee: i.assignee ? { username: i.assignee } : null,
    };
  }

  private applyUpdate(issue: FakeGitLabIssue, campos: Record<string, string>): void {
    const labels = new Set(issue.labels ?? []);
    for (const remover of (campos.remove_labels ?? "").split(",").filter(Boolean)) labels.delete(remover);
    for (const adicionar of (campos.add_labels ?? "").split(",").filter(Boolean)) labels.add(adicionar);
    issue.labels = [...labels];
    if (campos.state_event === "close") issue.state = "closed";
    if (campos.state_event === "reopen") issue.state = "opened";
  }
}

function ok(body: unknown): GhExecResult {
  return { stdout: JSON.stringify(body), stderr: "", exitCode: 0 };
}

function notFound(): GhExecResult {
  return { stdout: "", stderr: "404 Not Found", exitCode: 1 };
}

/** Valor da flag `nome valor` em `args`. */
function flag(args: string[], nome: string): string | undefined {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Campos `-f chave=valor` e `-F chave=valor`. */
function fields(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "-f" && args[i] !== "-F") continue;
    const par = args[i + 1] ?? "";
    const corte = par.indexOf("=");
    if (corte > 0) out[par.slice(0, corte)] = par.slice(corte + 1);
  }
  return out;
}
