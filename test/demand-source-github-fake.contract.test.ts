import { createGitHubDemandSource } from "../src/github-demand-source.js";
import { describeDemandSourceContract } from "./demand-source.contract.js";
import { FakeGhIssues } from "./fakes/fake-gh-issues.js";

// O adaptador GitHub contra um `gh` falso: toda issue aberta é um card do dono configurado.
describeDemandSourceContract("GitHubDemandSource (gh falso)", () => {
  const gh = new FakeGhIssues("dono/repo", "dono");
  // Mais issues do que cabem numa página da API (100).
  gh.issues = [
    { number: 1, title: "Primeira issue", body: "Corpo", author: "dono" },
    ...Array.from({ length: 120 }, (_, i) => ({ number: 10 + i, title: `Issue ${10 + i}` })),
    { number: 500, title: "Um PR", pull_request: true },
    { number: 501, title: "Fechada", state: "closed" as const },
  ];
  gh.addComment(1, "outra", "Olá @dono\nsegunda linha");
  const failing = new FakeGhIssues("dono/repo", "dono");
  failing.failWith = "gh: HTTP 401 Bad credentials";
  return {
    source: createGitHubDemandSource({ project: "SF", repo: "dono/repo", assignee: "dono", runner: gh.runner }),
    project: "SF",
    assignee: "dono",
    existingCardKey: "SF-1",
    transition: { fromStatus: "aberta", toStatus: "em-andamento" },
    assignedKeys: ["SF-1", ...Array.from({ length: 120 }, (_, i) => `SF-${10 + i}`)],
    failing: [
      {
        name: "credencial inválida",
        source: createGitHubDemandSource({
          project: "SF",
          repo: "dono/repo",
          assignee: "dono",
          runner: failing.runner,
        }),
      },
    ],
  };
});
