import type { GhExecResult, GhRunner } from "../../src/github-demand-source.js";

export interface FakeIssue {
  number: number;
  title: string;
  body?: string;
  state?: "open" | "closed";
  /** Motivo do fechamento (`state_reason`). */
  stateReason?: string;
  labels?: string[];
  author?: string;
  pull_request?: boolean;
  /** Quantas sub-issues a issue tem (épico). */
  subIssues?: number;
}

/** `gh api` em memória para um único repositório, com paginação no formato `--paginate --slurp`. */
export class FakeGhIssues {
  issues: FakeIssue[] = [];
  comments = new Map<number, { id: number; body: string; user: { login: string } }[]>();
  calls: string[][] = [];
  /** PRs que citam cada issue (eventos `cross-referenced` da timeline). */
  references = new Map<number, { number: number; state: "open" | "closed"; merged?: boolean; repo?: string }[]>();
  failWith?: string;
  /** Chamado em cada leitura de uma issue (simula outra pessoa mexendo entre a leitura e a escrita). */
  onRead?: () => void;
  private nextId = 1000;

  constructor(
    readonly repo: string,
    public me: string,
  ) {}

  addComment(number: number, login: string, body: string): number {
    const id = this.nextId++;
    this.comments.set(number, [...(this.comments.get(number) ?? []), { id, body, user: { login } }]);
    return id;
  }

  private raw(i: FakeIssue) {
    return {
      number: i.number,
      title: i.title,
      body: i.body ?? null,
      state: i.state ?? "open",
      labels: (i.labels ?? []).map((name) => ({ name })),
      user: { login: i.author ?? "estranho" },
      ...(i.pull_request ? { pull_request: { url: "x" } } : {}),
      sub_issues_summary: { total: i.subIssues ?? 0 },
    };
  }

  runner: GhRunner = async (args, input) => {
    this.calls.push(args);
    if (this.failWith) return { stdout: "", stderr: this.failWith, exitCode: 1 };
    const ok = (v: unknown): GhExecResult => ({ stdout: JSON.stringify(v), stderr: "", exitCode: 0 });
    const notFound: GhExecResult = { stdout: "", stderr: "gh: Not Found (HTTP 404)", exitCode: 1 };
    const method = args.includes("-X") ? args[args.indexOf("-X") + 1] : "GET";
    if (args.includes("user")) return ok({ login: this.me });
    const path = args.find((a) => a.startsWith("repos/")) ?? "";
    const body = input ? JSON.parse(input) : {};
    const base = `repos/${this.repo}/`;
    if (!path.startsWith(base)) return notFound;
    const rest = path.slice(base.length).split("?")[0] ?? "";
    if (rest === "issues") {
      const open = this.issues.filter((i) => (i.state ?? "open") === "open").map((i) => this.raw(i));
      const pages = [];
      for (let p = 0; p < open.length; p += 100) pages.push(open.slice(p, p + 100));
      return ok(pages.length ? pages : [[]]);
    }
    const edit = /^issues\/comments\/(\d+)$/.exec(rest);
    if (edit) {
      for (const list of this.comments.values()) {
        const c = list.find((x) => x.id === Number(edit[1]));
        if (c) {
          c.body = body.body;
          return ok(c);
        }
      }
      return notFound;
    }
    const onIssue = /^issues\/(\d+)\/comments$/.exec(rest);
    if (onIssue) {
      const n = Number(onIssue[1]);
      if (!this.issues.some((i) => i.number === n)) return notFound;
      if (method === "POST") {
        const id = this.addComment(n, this.me, body.body);
        return ok({ id, body: body.body, user: { login: this.me } });
      }
      return ok([this.comments.get(n) ?? []]);
    }
    const labels = /^issues\/(\d+)\/labels(?:\/(.+))?$/.exec(rest);
    if (labels) {
      const issue = this.issues.find((i) => i.number === Number(labels[1]));
      if (!issue) return notFound;
      const current = issue.labels ?? [];
      if (method === "POST") issue.labels = [...current, ...body.labels.filter((l: string) => !current.includes(l))];
      if (method === "DELETE") {
        const name = decodeURIComponent(labels[2] ?? "");
        if (!current.includes(name)) return { stdout: "", stderr: "gh: Label does not exist (HTTP 404)", exitCode: 1 };
        issue.labels = current.filter((l) => l !== name);
      }
      return ok((issue.labels ?? []).map((name) => ({ name })));
    }
    const timeline = /^issues\/(\d+)\/timeline$/.exec(rest);
    if (timeline) {
      const n = Number(timeline[1]);
      if (!this.issues.some((i) => i.number === n)) return notFound;
      const events = (this.references.get(n) ?? []).map((pr) => ({
        event: "cross-referenced",
        source: {
          type: "issue",
          issue: {
            number: pr.number,
            state: pr.state,
            pull_request: { merged_at: pr.merged ? "2026-01-01T00:00:00Z" : null },
            repository: { full_name: pr.repo ?? this.repo },
          },
        },
      }));
      return ok([[{ event: "labeled" }, ...events]]);
    }
    const one = /^issues\/(\d+)$/.exec(rest);
    if (one) {
      const issue = this.issues.find((i) => i.number === Number(one[1]));
      if (!issue) return notFound;
      if (method === "PATCH") {
        if (body.state) issue.state = body.state;
        if (body.state_reason) issue.stateReason = body.state_reason;
        if (body.labels) issue.labels = body.labels;
      }
      const response = ok(this.raw(issue));
      // Depois da resposta: a mudança alheia acontece entre a leitura e a próxima escrita.
      if (method === "GET") this.onRead?.();
      return response;
    }
    return notFound;
  };
}
