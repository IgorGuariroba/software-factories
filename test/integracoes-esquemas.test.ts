import { afterEach, describe, expect, it } from "vitest";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";
import { api, startTestFactory, type TestFactory } from "./harness.js";

type Campo = { campo: string; obrigatorio: boolean };
type Esquema = { tipo: string; campos: Campo[] };

describe("integrações: cada adaptador declara o próprio schema, e a configuração é validada por ele (fatia 04)", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("a API lista as Fontes disponíveis com os campos de cada uma", async () => {
    f = await startTestFactory({});

    const esquemas = await api<Esquema[]>(f, "GET", "/integracoes/fontes");

    const tipos = esquemas.map((e) => e.tipo);
    expect(tipos).toEqual(expect.arrayContaining(["jira", "github", "gitlab"]));
    const gitlab = esquemas.find((e) => e.tipo === "gitlab");
    expect(gitlab?.campos.map((c) => c.campo)).toEqual(
      expect.arrayContaining(["project", "repo", "assignee", "hostname"]),
    );
    const github = esquemas.find((e) => e.tipo === "github");
    expect(github?.campos.map((c) => c.campo)).toEqual(expect.arrayContaining(["project", "repo", "assignee"]));
    expect(github?.campos.find((c) => c.campo === "repo")?.obrigatorio).toBe(true);
  });

  it("trocar a Fonte para GitHub Issues cria a Fonte do novo tipo e salva a configuração", async () => {
    const criadas: string[] = [];
    f = await startTestFactory({
      createSource: (config) => {
        criadas.push(config.source.type);
        return new MemoryDemandSource([]);
      },
    });
    const atual = await api<{ source: unknown }>(f, "GET", "/projetos/exemplo/configuracao");

    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...atual,
      source: { type: "github", project: "PROJ", repo: "dono/repo", assignee: "dono", ignoreLabels: ["epic"] },
    });

    expect(criadas).toContain("github");
    const lido = await api<{ source: { type: string; repo: string } }>(f, "GET", "/projetos/exemplo/configuracao");
    expect(lido.source).toMatchObject({ type: "github", repo: "dono/repo" });
  });

  it("recusa uma Fonte GitHub sem repositório, com a mensagem apontando o campo", async () => {
    f = await startTestFactory({});
    const atual = await api<{ source: unknown }>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await fetch(`${f.url}/projetos/exemplo/configuracao`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...atual, source: { type: "github", project: "PROJ", assignee: "dono" } }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("repo");
  });
});
