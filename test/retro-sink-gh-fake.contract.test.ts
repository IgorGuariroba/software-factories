import { expect, it } from "vitest";
import { createGhRetroSink } from "../src/retro-sink.js";
import { FakeGh } from "./fakes/fake-gh.js";
import { describeRetroSinkContract } from "./retro-sink.contract.js";

it("lista todas as issues abertas de retrô e todos os comentários, mesmo após os limites de página", async () => {
  const gh = new FakeGh();
  const repo = "fabrica/fabrica-teste";
  for (let i = 0; i < 205; i++) gh.store.seed(repo, { title: `Melhoria ${i}`, labels: ["retro"] });
  const last = gh.store.issuesOf(repo)[204];
  if (!last) throw new Error("issue ausente");
  for (let i = 0; i < 105; i++) last.comments.push(`comentário ${i}`);
  const issues = await createGhRetroSink({ runner: gh.runner }).listOpen(repo);
  expect(issues).toHaveLength(205);
  expect(issues.find((issue) => issue.number === last.number)?.comments).toHaveLength(105);
  expect(issues.find((issue) => issue.number === last.number)?.comments).toContain("comentário 104");
});

// O adaptador `gh` contra um `gh` falso nos formatos do GitHub (lista em JSON, URL impressa na criação).
describeRetroSinkContract("GhRetroSink (gh falso)", () => {
  const gh = new FakeGh();
  const repo = "fabrica/fabrica-teste";
  return {
    sink: createGhRetroSink({ runner: gh.runner }),
    repo,
    seedHidden: async (title, kind) => {
      gh.store.seed(repo, kind === "fechada" ? { title, state: "closed" } : { title, labels: ["bug"] });
    },
  };
});
