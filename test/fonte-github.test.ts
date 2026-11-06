import { describe, expect, it } from "vitest";
import { ProjectConfig } from "../src/config.js";
import { createGitHubDemandSource } from "../src/github-demand-source.js";
import { FakeGhIssues } from "./fakes/fake-gh-issues.js";

function setup() {
  const gh = new FakeGhIssues("dono/repo", "dono");
  gh.issues = [{ number: 7, title: "Bug", labels: ["bug"] }];
  const source = createGitHubDemandSource({ project: "SF", repo: "dono/repo", assignee: "dono", runner: gh.runner });
  return { gh, source };
}

describe("Fonte GitHub: o que é só do GitHub", () => {
  it("pull requests e issues fechadas não viram cards; outra pessoa não tem cards", async () => {
    const { gh, source } = setup();
    gh.issues.push({ number: 8, title: "PR", pull_request: true }, { number: 9, title: "x", state: "closed" });
    expect((await source.listAssignedCards("dono")).map((c) => c.key)).toEqual(["SF-7"]);
    expect(await source.listAssignedCards("estranho")).toEqual([]);
    expect(await source.getCard("SF-8")).toBeUndefined();
  });

  it("o status é o label fabrica:<status> e a transição preserva os outros labels", async () => {
    const { gh, source } = setup();
    await source.transition("SF-7", "Em-Andamento");
    expect(gh.issues[0]?.labels).toEqual(["bug", "fabrica:em-andamento"]);
    await source.transition("SF-7", "aguardando-revisao");
    expect(gh.issues[0]?.labels).toEqual(["bug", "fabrica:aguardando-revisao"]);
    expect((await source.getCard("SF-7"))?.status).toBe("aguardando-revisao");
  });

  it("transicionar para fechada fecha a issue, sem label da fábrica", async () => {
    const { gh, source } = setup();
    await source.transition("SF-7", "em-andamento");
    await source.transition("SF-7", "fechada");
    expect(gh.issues[0]).toMatchObject({ state: "closed", labels: ["bug"] });
    expect((await source.getCard("SF-7"))?.status).toBe("fechada");
  });

  it("escrever em card de outro projeto falha sem chamar o gh", async () => {
    const { gh, source } = setup();
    await expect(source.addComment("OUTRO-7", "x")).rejects.toThrow(/OUTRO-7/);
    expect(gh.calls).toEqual([]);
  });

  it("menção é @login", () => {
    expect(setup().source.formatMention("igor")).toBe("@igor");
  });
});

describe("Config da Fonte GitHub", () => {
  const base = { name: "fabrica", roles: { spec: { provider: "x", model: "y" } }, statuses: {} };
  it("aceita repo dono/nome e recusa outro formato", () => {
    const ok = ProjectConfig.safeParse({
      ...base,
      source: { type: "github", project: "SF", repo: "dono/repo", assignee: "dono" },
    });
    expect(ok.success).toBe(true);
    const bad = ProjectConfig.safeParse({
      ...base,
      source: { type: "github", project: "SF", repo: "https://github.com/x", assignee: "dono" },
    });
    expect(bad.success).toBe(false);
  });
});

describe("Fonte GitHub: identidade e labels", () => {
  it("autor com outra caixa é reconhecido como o dono configurado", async () => {
    const { gh, source } = setup();
    gh.addComment(7, "DONO", "meu");
    expect((await source.listComments("SF-7"))[0]?.author).toBe("dono");
  });

  it("recusa escrever quando a conta do gh não é o dono", async () => {
    const gh = new FakeGhIssues("dono/repo", "outra-conta");
    gh.issues = [{ number: 7, title: "Bug" }];
    const source = createGitHubDemandSource({ project: "SF", repo: "dono/repo", assignee: "dono", runner: gh.runner });
    await expect(source.addComment("SF-7", "x")).rejects.toThrow(/outra-conta/);
    await expect(source.transition("SF-7", "em-andamento")).rejects.toThrow(/outra-conta/);
    expect(gh.comments.get(7)).toBeUndefined();
  });

  it("a transição só mexe nos labels fabrica:*: um label adicionado por outra pessoa no meio é preservado", async () => {
    const { gh, source } = setup();
    gh.onRead = () => {
      gh.issues[0]?.labels?.push("urgente");
      gh.onRead = undefined;
    };
    await source.transition("SF-7", "em-andamento");
    expect(gh.issues[0]?.labels).toEqual(["bug", "urgente", "fabrica:em-andamento"]);
  });

  it("confere a conta a cada escrita: trocar de conta no gh depois da primeira escrita é recusado", async () => {
    const gh = new FakeGhIssues("dono/repo", "dono");
    gh.issues = [{ number: 7, title: "Bug" }];
    const source = createGitHubDemandSource({ project: "SF", repo: "dono/repo", assignee: "dono", runner: gh.runner });
    await source.addComment("SF-7", "primeiro");
    gh.me = "outra-conta";
    await expect(source.addComment("SF-7", "segundo")).rejects.toThrow(/outra-conta/);
  });

  it("label de status apagado por outra pessoa no meio (404 no DELETE) não impede a transição", async () => {
    const { gh, source } = setup();
    await source.transition("SF-7", "em-andamento");
    gh.onRead = () => {
      if (gh.issues[0]) gh.issues[0].labels = ["bug"];
      gh.onRead = undefined;
    };
    await source.transition("SF-7", "fechada");
    expect(gh.issues[0]).toMatchObject({ state: "closed", labels: ["bug"] });
  });
});
