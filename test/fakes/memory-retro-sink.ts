import { RETRO_LABEL, type RetroIssue, type RetroSink } from "../../src/retro-sink.js";

/** Uma issue no repositório falso, com labels e estado para os testes semearem casos. */
export interface StoredIssue extends RetroIssue {
  repo: string;
  labels: string[];
  state: "open" | "closed";
}

/** `RetroSink` em memória: as issues de todos os repositórios, como o GitHub as guardaria. */
export class MemoryRetroSink implements RetroSink {
  readonly issues: StoredIssue[] = [];
  /** Força uma falha nas próximas `n` chamadas (ex.: o GitHub fora do ar). */
  failNext = 0;
  private nextNumber = 1;

  private check(): void {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("GitHub fora do ar");
    }
  }

  /** Para os testes: uma issue que já existia no repositório. */
  seed(repo: string, issue: { title: string; body?: string; labels?: string[]; state?: "open" | "closed" }) {
    const number = this.nextNumber++;
    const stored: StoredIssue = {
      repo,
      number,
      title: issue.title,
      body: issue.body ?? "",
      url: `https://github.invalid/${repo}/issues/${number}`,
      comments: [],
      labels: issue.labels ?? [RETRO_LABEL],
      state: issue.state ?? "open",
    };
    this.issues.push(stored);
    return stored;
  }

  issuesOf(repo: string): StoredIssue[] {
    return this.issues.filter((i) => i.repo === repo);
  }

  async listOpen(repo: string): Promise<RetroIssue[]> {
    this.check();
    return this.issues
      .filter((i) => i.repo === repo && i.state === "open" && i.labels.includes(RETRO_LABEL))
      .map(({ number, title, body, url, comments }) => ({ number, title, body, url, comments: [...comments] }));
  }

  async create(repo: string, issue: { title: string; body: string }) {
    this.check();
    const { number, url } = this.seed(repo, issue);
    return { number, url };
  }

  async comment(repo: string, number: number, body: string): Promise<void> {
    this.check();
    const issue = this.issues.find((i) => i.repo === repo && i.number === number);
    if (!issue) throw new Error(`issue ${repo}#${number} não existe`);
    issue.comments.push(body);
  }
}
