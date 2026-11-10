import { createGitLabDemandSource } from "../src/gitlab-demand-source.js";
import { describeDemandSourceContract } from "./demand-source.contract.js";
import { FakeGlabIssues } from "./fakes/fake-glab-issues.js";

// O adaptador GitLab Issues contra um `glab` falso: toda issue aberta atribuída ao usuário é um card.
describeDemandSourceContract("GitLabDemandSource (glab falso)", () => {
  const glab = new FakeGlabIssues("grupo/projeto", "dono");
  // Mais issues do que cabem numa página da API (100), e uma fechada que não entra na fila.
  glab.issues = [
    { iid: 1, title: "Primeira issue", description: "Corpo", author: "dono", assignee: "dono" },
    ...Array.from({ length: 120 }, (_, i) => ({ iid: 10 + i, title: `Issue ${10 + i}`, assignee: "dono" })),
    { iid: 501, title: "Fechada", state: "closed" as const, assignee: "dono" },
  ];
  glab.addComment(1, "outra", "Olá @dono\nsegunda linha");
  const failing = new FakeGlabIssues("grupo/projeto", "dono");
  failing.failWith = "glab: 401 Unauthorized";
  return {
    source: createGitLabDemandSource({ project: "GL", repo: "grupo/projeto", assignee: "dono", runner: glab.runner }),
    project: "GL",
    assignee: "dono",
    existingCardKey: "GL-1",
    transition: { fromStatus: "aberta", toStatus: "em-andamento" },
    assignedKeys: ["GL-1", ...Array.from({ length: 120 }, (_, i) => `GL-${10 + i}`)],
    failing: [
      {
        name: "credencial inválida",
        source: createGitLabDemandSource({
          project: "GL",
          repo: "grupo/projeto",
          assignee: "dono",
          runner: failing.runner,
        }),
      },
    ],
  };
});
