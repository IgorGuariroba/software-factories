import { mkdir } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { api, startTestFactory, type TestFactory } from "./harness.js";

/** GitLab falso só para a criação: o token `glpat-ok` vê `grupo/projeto`. */
const fetchGitlab = (async (url: string, init?: RequestInit) => {
  const alvo = new URL(url);
  const token = new Headers(init?.headers).get("PRIVATE-TOKEN");
  if (token === "glpat-ok" && alvo.pathname === "/api/v4/projects/grupo%2Fprojeto") {
    return new Response(JSON.stringify({ path_with_namespace: "grupo/projeto" }), { status: 200 });
  }
  if (token === "glpat-ok" && alvo.pathname === "/api/v4/projects/grupo%2Fprojeto/members/all") {
    return new Response("[]", { status: 200 });
  }
  return new Response('{"message":"404"}', { status: 404 });
}) as unknown as typeof fetch;

type Alteracao = { quando: string; autor: string; campos: string[] };

describe("histórico de alterações de configuração (fatia 12)", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("cada gravação registra quando, quem e quais campos mudaram, sem os valores", async () => {
    f = await startTestFactory({ config: { name: "exemplo", dryRun: true } });
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");

    await api(f, "PUT", "/projetos/exemplo/configuracao", { ...atual, dryRun: false });

    const historico = await api<Alteracao[]>(f, "GET", "/projetos/exemplo/historico");
    expect(historico).toHaveLength(1);
    expect(historico[0]?.campos).toEqual(["dryRun"]);
    expect(historico[0]?.autor).toBe("usuario");
    expect(new Date(historico[0]?.quando ?? "").toString()).not.toBe("Invalid Date");
    expect(JSON.stringify(historico)).not.toContain("false");
  });

  it("uma gravação sem mudança de campo não gera registro", async () => {
    f = await startTestFactory({ config: { name: "exemplo" } });
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");

    await api(f, "PUT", "/projetos/exemplo/configuracao", atual);

    expect(await api<Alteracao[]>(f, "GET", "/projetos/exemplo/historico")).toEqual([]);
  });

  it("campo ausente e lista vazia não contam como alteração", async () => {
    f = await startTestFactory({ config: { name: "exemplo" } });
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");
    const semCampo = { ...atual, skills: undefined, mcpServers: undefined };

    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...semCampo,
      skills: [],
      mcpServers: [],
      telegram: { content: "full" },
    });

    expect(await api<Alteracao[]>(f, "GET", "/projetos/exemplo/historico")).toEqual([]);
  });

  it("alterações saem em ordem cronológica, e a remoção entra como a última", async () => {
    f = await startTestFactory({ config: { name: "exemplo", dryRun: true } });
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");
    await api(f, "PUT", "/projetos/exemplo/configuracao", { ...atual, dryRun: false });
    await api(f, "PUT", "/projetos/exemplo/configuracao", { ...atual, dryRun: true });

    const remocao = await fetch(`${f.url}/projetos/exemplo/remocao`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmar: "exemplo" }),
    });
    expect(remocao.status).toBe(200);

    const historico = await api<Alteracao[]>(f, "GET", "/projetos/exemplo/historico");
    expect(historico.map((h) => h.campos)).toEqual([["dryRun"], ["dryRun"], ["projeto removido"]]);
    const quando = historico.map((h) => Date.parse(h.quando));
    expect([...quando].sort((a, b) => a - b)).toEqual(quando);
  });

  it("depois da remoção o histórico segue consultável, mas um nome que nunca existiu continua 404", async () => {
    f = await startTestFactory({ config: { name: "exemplo" } });
    await fetch(`${f.url}/projetos/exemplo/remocao`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmar: "exemplo" }),
    });

    expect(await api<Alteracao[]>(f, "GET", "/projetos/exemplo/historico")).toHaveLength(1);
    expect((await fetch(`${f.url}/projetos/nunca/historico`)).status).toBe(404);
  });

  it("a criação pela interface também entra no histórico, como primeira alteração", async () => {
    f = await startTestFactory({
      fetchGitlab,
      clonarRepositorioGitlab: async (opts) => {
        await mkdir(opts.destino, { recursive: true });
      },
    });
    await api(f, "PUT", "/segredos/gitlab-token", { valor: "glpat-ok" });

    const res = await fetch(`${f.url}/projetos/gitlab`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nome: "app-novo",
        caminho: "grupo/projeto",
        servidor: "",
        fonte: { project: "NOV", assignee: "fulano", credential: "gitlab-token" },
        comandoTeste: ["npm", "test"],
      }),
    });
    expect(res.status).toBe(201);

    const historico = await api<Alteracao[]>(f, "GET", "/projetos/app-novo/historico");
    expect(historico.map((h) => h.campos)).toEqual([["projeto criado"]]);
    expect(historico[0]?.autor).toBe("usuario");
  });

  it("responde 404 para o histórico de um projeto que não existe", async () => {
    f = await startTestFactory({});

    const res = await fetch(`${f.url}/projetos/inexistente/historico`);

    expect(res.status).toBe(404);
  });
});
