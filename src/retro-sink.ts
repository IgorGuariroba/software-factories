import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** A label das issues de retrô no repositório da fábrica. */
export const RETRO_LABEL = "retro";

/** Uma issue de retrô aberta no repositório da fábrica, com o corpo dos comentários. */
export interface RetroIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  comments: string[];
}

/**
 * Onde as melhorias da própria fábrica viram issues (SPEC, "Portas"). `repo` é `dono/nome` do repositório da fábrica.
 * Toda escrita passa pelo escritor de efeitos; a porta não aplica guardrail nem saneamento.
 */
export interface RetroSink {
  /** Issues abertas com a label `retro`, para o dedupe por similaridade. */
  listOpen(repo: string): Promise<RetroIssue[]>;
  /** Abre uma issue com a label `retro`. */
  create(repo: string, issue: { title: string; body: string }): Promise<{ number: number; url: string }>;
  /** Comenta numa issue. */
  comment(repo: string, issue: number, body: string): Promise<void>;
}

export interface GhExecResult {
  stdout: string;
  stderr: string;
  exitCode?: number;
}

/** Runner injetável do `gh`, como o `AcliRunner`: os testes usam um `gh` falso. */
export type GhRunner = (args: string[]) => Promise<GhExecResult>;

/** Runner padrão: o binário `gh` (ou `GH_PATH`), com as credenciais do usuário (ADR-0003). */
export const defaultGhRunner: GhRunner = async (args) => {
  try {
    const { stdout, stderr } = await execFileAsync(process.env.GH_PATH || "gh", args, {
      maxBuffer: 20 * 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? String(error),
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
};

/** Adaptador real do `RetroSink`: GitHub pelo `gh`. A label `retro` precisa existir no repositório. */
export function createGhRetroSink(opts: { runner?: GhRunner } = {}): RetroSink {
  const runner = opts.runner ?? defaultGhRunner;
  async function gh(args: string[]): Promise<string> {
    const result = await runner(args);
    if ((result.exitCode ?? 0) !== 0)
      throw new Error(`gh ${args.slice(0, 2).join(" ")} falhou: ${result.stderr.trim() || "erro desconhecido"}`);
    return result.stdout;
  }

  return {
    async listOpen(repo) {
      const stdout = await gh([
        "api",
        "--paginate",
        "--slurp",
        `repos/${repo}/issues?state=open&labels=${RETRO_LABEL}&per_page=100`,
      ]);
      const pages = JSON.parse(stdout || "[]") as {
        number: number;
        title: string;
        body?: string;
        html_url: string;
        comments: number;
        pull_request?: unknown;
      }[][];
      const issues: RetroIssue[] = [];
      for (const issue of pages.flat()) {
        if (issue.pull_request) continue;
        const comments = issue.comments
          ? (
              JSON.parse(
                await gh([
                  "api",
                  "--paginate",
                  "--slurp",
                  `repos/${repo}/issues/${issue.number}/comments?per_page=100`,
                ]),
              ) as { body?: string }[][]
            )
              .flat()
              .map((c) => c.body ?? "")
          : [];
        issues.push({
          number: issue.number,
          title: issue.title,
          body: issue.body ?? "",
          url: issue.html_url,
          comments,
        });
      }
      return issues;
    },
    async create(repo, issue) {
      const stdout = await gh([
        "issue",
        "create",
        "--repo",
        repo,
        "--title",
        issue.title,
        "--body",
        issue.body,
        "--label",
        RETRO_LABEL,
      ]);
      // O `gh issue create` imprime a URL da issue criada.
      const url = stdout
        .trim()
        .split(/\s+/)
        .find((w) => /\/issues\/\d+$/.test(w));
      const number = Number(url?.match(/\/issues\/(\d+)$/)?.[1]);
      if (!url || !Number.isInteger(number)) throw new Error(`gh issue create não devolveu a URL da issue: ${stdout}`);
      return { number, url };
    },
    async comment(repo, issue, body) {
      await gh(["issue", "comment", String(issue), "--repo", repo, "--body", body]);
    },
  };
}
