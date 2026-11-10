import { afterEach, describe, expect, it } from "vitest";
import { createGitHubDemandSource, type GhRunner } from "../src/github-demand-source.js";
import { api, startTestFactory, type TestFactory } from "./harness.js";

// Ticket 04: a Fonte GitHub Issues aceita credencial do cofre; o token vai ao `gh` pela variável que ele lê.
describe("Fonte GitHub Issues com credencial do cofre", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("o gh recebe o token do cofre em GH_TOKEN, e nada é passado sem credencial", async () => {
    const envs: (Record<string, string> | undefined)[] = [];
    const runner: GhRunner = async (_args, _input, env) => {
      envs.push(env);
      return { stdout: "[]", stderr: "", exitCode: 0 };
    };
    const fonte = createGitHubDemandSource({
      project: "SF",
      repo: "dono/repo",
      assignee: "dono",
      runner,
      token: async () => "ghp_do_cofre",
    });

    await fonte.listAssignedCards("dono");

    expect(envs[0]).toEqual({ GH_TOKEN: "ghp_do_cofre" });
  });

  it("a configuração recusa uma Fonte GitHub cuja credencial não está no cofre", async () => {
    f = await startTestFactory({});
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await fetch(`${f.url}/projetos/exemplo/configuracao`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...atual,
        source: { type: "github", project: "SF", repo: "dono/repo", assignee: "dono", credential: "github-token" },
      }),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("credencial github-token não cadastrada");
  });

  it("o schema da Fonte GitHub tem o campo de credencial", async () => {
    f = await startTestFactory({});
    const esquemas = await api<{ tipo: string; campos: { campo: string }[] }[]>(f, "GET", "/integracoes/fontes");
    expect(esquemas.find((e) => e.tipo === "github")?.campos.map((c) => c.campo)).toContain("credential");
  });
});
