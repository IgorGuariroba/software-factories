import { afterEach, describe, expect, it } from "vitest";
import { createGitLabDemandSource, type GlabRunner } from "../src/gitlab-demand-source.js";
import { api, startTestFactory, type TestFactory } from "./harness.js";

// Ticket 05: a Fonte GitLab tem nome da credencial no schema, e o token sai do cofre pela variável que o glab lê.
describe("Fonte GitLab com credencial do cofre", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("o glab recebe o token do cofre em GITLAB_TOKEN, e nada é passado sem credencial", async () => {
    const envs: (Record<string, string> | undefined)[] = [];
    const runner: GlabRunner = async (_args, _input, env) => {
      envs.push(env);
      return { stdout: "[]", stderr: "", exitCode: 0 };
    };
    const fonte = createGitLabDemandSource({
      project: "GL",
      repo: "grupo/projeto",
      assignee: "dono",
      runner,
      token: async () => "glpat-do-cofre",
    });

    await fonte.listAssignedCards("dono");

    expect(envs[0]).toEqual({ GITLAB_TOKEN: "glpat-do-cofre" });
  });

  it("a configuração recusa uma Fonte GitLab cuja credencial não está no cofre", async () => {
    f = await startTestFactory({});
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await fetch(`${f.url}/projetos/exemplo/configuracao`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...atual,
        source: { type: "gitlab", project: "GL", repo: "grupo/projeto", assignee: "dono", credential: "gitlab-token" },
      }),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("credencial gitlab-token não cadastrada");
  });

  it("o schema da Fonte GitLab tem o campo de credencial", async () => {
    f = await startTestFactory({});
    const esquemas = await api<{ tipo: string; campos: { campo: string }[] }[]>(f, "GET", "/integracoes/fontes");
    expect(esquemas.find((e) => e.tipo === "gitlab")?.campos.map((c) => c.campo)).toContain("credential");
  });
});
