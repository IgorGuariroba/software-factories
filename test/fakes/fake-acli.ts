import type { AcliExecResult, AcliRunner } from "../../src/jira-demand-source.js";

/** Uma pessoa como o Jira a devolve nos campos `assignee` e `comment.author`. */
export interface FakeJiraPerson {
  accountId: string;
  emailAddress: string;
  displayName: string;
}

export interface FakeJiraIssue {
  key: string;
  summary: string;
  status: string;
  assignee: FakeJiraPerson | null;
  description?: unknown;
  attachments?: { id: string; filename: string; mimeType: string; size: number; content: string }[];
}

interface FakeJiraComment {
  id: string;
  author: FakeJiraPerson;
  body: unknown;
}

const paragraph = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
/** Texto simples → ADF, uma linha por parágrafo (como o Jira guarda um corpo enviado em texto). */
export const toAdf = (text: string) => ({ type: "doc", version: 1, content: text.split("\n").map(paragraph) });

const ok = (stdout: unknown): AcliExecResult => ({
  stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout),
  stderr: "",
  exitCode: 0,
});
const fail = (stderr: string): AcliExecResult => ({ stdout: "", stderr, exitCode: 1 });
const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/**
 * Um `acli` falso que responde nos formatos do Jira Cloud: `search` devolve um array de issues (50 por página sem
 * `--paginate`), `view --fields comment` devolve `fields.comment` com autores-objeto e corpo ADF, e
 * `comment create --json` devolve um id (ou não, com `createReturnsId = false`).
 */
export class FakeAcli {
  issues: FakeJiraIssue[] = [];
  private comments = new Map<string, FakeJiraComment[]>();
  private nextCommentId = 10000;
  /** Se `false`, `comment create --json` não devolve o id do comentário criado. */
  createReturnsId = true;
  /** Força uma falha (exit 1) no próximo comando cujo texto contenha a chave. */
  failNext: { match: string; stderr: string } | undefined;
  calls: string[][] = [];

  constructor(public me: FakeJiraPerson) {}

  /** Para os testes: um comentário escrito por outra pessoa (ou por mim, por fora da fábrica). */
  addHumanComment(key: string, author: FakeJiraPerson, text: string): string {
    const id = String(this.nextCommentId++);
    this.comments.set(key, [...(this.comments.get(key) ?? []), { id, author, body: toAdf(text) }]);
    return id;
  }

  readonly runner: AcliRunner = async (args) => {
    this.calls.push(args);
    if (this.failNext && args.join(" ").includes(this.failNext.match)) {
      const { stderr } = this.failNext;
      this.failNext = undefined;
      return fail(stderr);
    }
    const [, , cmd, sub] = args;
    if (cmd === "search") return this.search(args);
    if (cmd === "view") return this.view(sub, flag(args, "--fields") ?? "");
    if (cmd === "transition") return this.transition(flag(args, "--key") ?? "", flag(args, "--status") ?? "");
    if (cmd === "comment" && sub === "create")
      return this.create(flag(args, "--key") ?? "", flag(args, "--body") ?? "");
    if (cmd === "comment" && sub === "update")
      return this.update(flag(args, "--key") ?? "", flag(args, "--id") ?? "", flag(args, "--body") ?? "");
    return fail(`comando desconhecido: ${args.join(" ")}`);
  };

  private issue(key: string) {
    return this.issues.find((i) => i.key === key);
  }

  private search(args: string[]): AcliExecResult {
    const jql = flag(args, "--jql") ?? "";
    const project = /project = "([^"]+)"/.exec(jql)?.[1];
    const assignee = /assignee = "([^"]+)"/.exec(jql)?.[1];
    const found = this.issues.filter(
      (i) =>
        (!project || i.key.startsWith(`${project}-`)) &&
        (!assignee || i.assignee?.accountId === assignee || i.assignee?.emailAddress === assignee),
    );
    const page = args.includes("--paginate") ? found : found.slice(0, 50);
    return ok(page.map((i) => this.issueJson(i, "key,summary,status,assignee,description")));
  }

  private issueJson(i: FakeJiraIssue, fields: string) {
    const all: Record<string, unknown> = {
      summary: i.summary,
      status: { name: i.status, statusCategory: { key: "new" } },
      assignee: i.assignee ? { ...i.assignee, active: true } : null,
      description: i.description ?? null,
      attachment: i.attachments ?? [],
      comment: (() => {
        const comments = (this.comments.get(i.key) ?? []).map((c) => ({
          ...c,
          created: "2026-01-01T00:00:00.000+0000",
          updated: "2026-01-01T00:00:00.000+0000",
          updateAuthor: c.author,
        }));
        return { comments, total: comments.length, maxResults: comments.length, startAt: 0 };
      })(),
    };
    const wanted = fields.split(",");
    return { key: i.key, fields: Object.fromEntries(Object.entries(all).filter(([k]) => wanted.includes(k))) };
  }

  private view(key: string, fields: string): AcliExecResult {
    const i = this.issue(key);
    if (!i) return fail(`✗ Error: Issue does not exist or you do not have permission to see it: ${key}`);
    return ok(this.issueJson(i, fields));
  }

  private transition(key: string, status: string): AcliExecResult {
    const i = this.issue(key);
    if (!i) return fail(`✗ Error: Issue does not exist: ${key}`);
    i.status = status;
    return ok(`✓ Work item ${key} transitioned to ${status}`);
  }

  private create(key: string, body: string): AcliExecResult {
    if (!this.issue(key)) return fail(`✗ Error: Issue does not exist: ${key}`);
    const id = this.addHumanComment(key, this.me, body);
    return ok(this.createReturnsId ? { id, self: `https://exemplo.invalid/comment/${id}` } : { ok: true });
  }

  private update(key: string, id: string, body: string): AcliExecResult {
    const comment = (this.comments.get(key) ?? []).find((c) => c.id === id);
    if (!comment) return fail(`✗ Error: Comment ${id} not found`);
    comment.body = toAdf(body);
    return ok(`✓ Comment ${id} updated`);
  }
}
