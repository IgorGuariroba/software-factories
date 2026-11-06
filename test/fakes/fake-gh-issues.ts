import type { GhExecResult, GhRunner } from "../../src/github-demand-source.js";

export interface FakeIssue {
  number: number;
  title: string;
  body?: string;
  state?: "open" | "closed";
  labels?: string[];
  author?: string;
  pull_request?: boolean;
}

/** `gh api` em memória para um único repositório, com paginação no formato `--paginate --slurp`. */
export class FakeGhIssues {
  issues: FakeIssue[] = [];
  comments = new Map<number, { id: number; body: string; user: { login: string } }[]>();
  calls: string[][] = [];
  failWith?: string;
  /** Chamado em cada leitura de uma issue (simula outra pessoa mexendo entre a leitura e a escrita). */
  onRead?: () => void;
  private nextId = 1000;

  constructor(
    readonly repo: string,
    readonly me: string,
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
      if (method === "DELETE") issue.labels = current.filter((l) => l !== decodeURIComponent(labels[2] ?? ""));
      return ok((issue.labels ?? []).map((name) => ({ name })));
    }
    const one = /^issues\/(\d+)$/.exec(rest);
    if (one) {
      const issue = this.issues.find((i) => i.number === Number(one[1]));
      if (!issue) return notFound;
      if (method === "GET") this.onRead?.();
      if (method === "PATCH") {
        if (body.state) issue.state = body.state;
        if (body.labels) issue.labels = body.labels;
      }
      return ok(this.raw(issue));
    }
    return notFound;
  };
}
