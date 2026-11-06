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

  it("épicos ficam fora: issue com sub-issues ou com label ignorado (padrão epic, sem diferença de caixa)", async () => {
    const { gh, source } = setup();
    gh.issues.push({ number: 8, title: "M1", subIssues: 20 }, { number: 9, title: "Roadmap", labels: ["Epic"] });
    expect((await source.listAssignedCards("dono")).map((c) => c.key)).toEqual(["SF-7"]);
    const custom = createGitHubDemandSource({
      project: "SF",
      repo: "dono/repo",
      assignee: "dono",
      ignoreLabels: ["bug"],
      runner: gh.runner,
    });
    expect((await custom.listAssignedCards("dono")).map((c) => c.key)).toEqual(["SF-9"]);
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
    gh.calls.length = 0;
    await source.transition("SF-7", "fechada");
    expect(gh.issues[0]).toMatchObject({ state: "closed", labels: ["bug"] });
    // O caminho do 404 foi de fato exercitado: houve o DELETE do label já removido.
    expect(gh.calls).toContainEqual(["api", "-X", "DELETE", "repos/dono/repo/issues/7/labels/fabrica%3Aem-andamento"]);
  });

  it("PRs que citam a issue, pela timeline: mergeado, aberto ou fechado; de outro repositório não contam", async () => {
    const { gh, source } = setup();
    gh.references.set(7, [
      { number: 20, state: "closed", merged: true },
      { number: 21, state: "open" },
      { number: 22, state: "closed" },
      { number: 23, state: "open", repo: "outro/repo" },
    ]);
    expect(await source.linkedPullRequests?.("SF-7")).toEqual([
      { number: 20, state: "merged" },
      { number: 21, state: "open" },
      { number: 22, state: "closed" },
    ]);
  });

  it("dar baixa fecha a issue com o motivo e tira os labels da fábrica, conferindo a conta", async () => {
    const { gh, source } = setup();
    await source.transition("SF-7", "em-andamento");
    await source.dismiss?.("SF-7", "duplicate");
    expect(gh.issues[0]).toMatchObject({ state: "closed", stateReason: "duplicate", labels: ["bug"] });
    gh.me = "outra-conta";
    gh.issues[0] = { number: 7, title: "Bug" };
    await expect(source.dismiss?.("SF-7", "not_planned")).rejects.toThrow(/outra-conta/);
    expect(gh.issues[0]?.state).toBeUndefined();
  });
});
