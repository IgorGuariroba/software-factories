import type { GhExecResult, GhRunner } from "../../src/retro-sink.js";
import { MemoryRetroSink } from "./memory-retro-sink.js";

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const ok = (stdout: string): GhExecResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr: string): GhExecResult => ({ stdout: "", stderr, exitCode: 1 });

/**
 * Um `gh` falso que entende `issue list|create|comment` nos formatos do GitHub: `list --json` devolve os campos pedidos
 * (comentários como objetos com `body`), `create` imprime a URL da issue. As issues ficam num `MemoryRetroSink`.
 */
export class FakeGh {
  readonly store = new MemoryRetroSink();
  readonly calls: string[][] = [];

  runner: GhRunner = async (args) => {
    this.calls.push(args);
    const [cmd, sub] = args;
    const repo = flag(args, "--repo");
    if (cmd !== "issue" || !repo) return fail(`comando não suportado: ${args.join(" ")}`);
    if (sub === "list") {
      const label = flag(args, "--label");
      const state = flag(args, "--state") ?? "open";
      const fields = (flag(args, "--json") ?? "").split(",");
      const limit = Number(flag(args, "--limit") ?? 30);
      const found = this.store
        .issuesOf(repo)
        .filter((i) => (!label || i.labels.includes(label)) && (state === "all" || i.state === state))
        .slice(0, limit)
        .map((i) => {
          const full: Record<string, unknown> = { ...i, comments: i.comments.map((body) => ({ body, author: {} })) };
          return Object.fromEntries(fields.map((f) => [f, full[f]]));
        });
      return ok(JSON.stringify(found));
    }
    if (sub === "create") {
      const title = flag(args, "--title");
      if (!title) return fail("título obrigatório");
      const created = this.store.seed(repo, {
        title,
        body: flag(args, "--body") ?? "",
        labels: [flag(args, "--label") ?? ""].filter(Boolean),
      });
      return ok(`Creating issue in ${repo}\n\n${created.url}\n`);
    }
    if (sub === "comment") {
      const number = Number(args[2]);
      const issue = this.store.issuesOf(repo).find((i) => i.number === number);
      if (!issue) return fail(`issue ${number} não encontrada`);
      issue.comments.push(flag(args, "--body") ?? "");
      return ok(`${issue.url}#issuecomment-1\n`);
    }
    return fail(`subcomando não suportado: ${sub}`);
  };
}
