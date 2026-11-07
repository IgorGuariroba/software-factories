import { describe, expect, it } from "vitest";
import { blockingThreads } from "../scripts/review-gate.mjs";

const thread = (body: string, extra: object = {}) => ({
  isResolved: false,
  path: "src/a.ts",
  line: 10,
  comments: { nodes: [{ author: { login: "github-actions" }, body, url: "https://x/1" }] },
  ...extra,
});

describe("portão do review do PR-Agent", () => {
  it("bloqueia só achado Critical ou Major do PR-Agent com thread não resolvida", () => {
    const threads = [
      thread("**Bug**\n\n**Critical** · Security: vaza token"),
      thread("**Ruído**\n\n**Major** · Functional Correctness: quebra"),
      thread("**Major** · Stability: resolvido", { isResolved: true }),
      thread("**Minor** · Stability: menor"),
      thread("**Trivial** · Style: detalhe"),
      // Só o PR-Agent conta: comentário de pessoa com a palavra não bloqueia.
      {
        ...thread("**Major** acho"),
        comments: { nodes: [{ author: { login: "IgorGuariroba" }, body: "**Major** acho" }] },
      },
      // "Major" fora do rótulo de severidade não conta.
      thread("**Minor** · Stability: mudança major de versão"),
    ];
    expect(blockingThreads(threads).map((t: { severity: string }) => t.severity)).toEqual(["Critical", "Major"]);
  });

  it("sem achados bloqueantes, libera", () => {
    expect(blockingThreads([])).toEqual([]);
  });
});
