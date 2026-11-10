import { afterEach, describe, expect, it } from "vitest";
import { api, startTestFactory, type TestFactory } from "./harness.js";

/** Grava a Fonte GitHub e os itens que a regra de ativação exige (ADR-0022), mantendo o resto da configuração. */
async function completarConfiguracao(f: TestFactory, pessoas: Record<string, unknown>[]): Promise<void> {
  const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");
  await api(f, "PUT", "/projetos/exemplo/configuracao", {
    ...atual,
    source: { type: "github", project: "PROJ", repo: "dono/repo", assignee: "dono" },
    repositories: [{ path: process.cwd(), prefix: "EX", test: { command: ["npm", "test"] } }],
    allowedProviders: ["anthropic"],
    people: pessoas,
  });
}

const PO = { id: "po-x", role: "po" as const };
const TECH_LEAD = { id: "tl-x", role: "tech_lead" as const };

describe("pendências de configuração (ADR-0022)", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("avisa quando não há ninguém no perfil PO", async () => {
    f = await startTestFactory({ config: { name: "exemplo", people: [] } });

    const pendencias = await api<string[]>(f, "GET", "/projetos/exemplo/pendencias");

    expect(pendencias.some((p) => /PO/.test(p))).toBe(true);
  });

  it("uma pessoa no perfil PO, por perfil e não por papel antigo, não gera pendência", async () => {
    f = await startTestFactory({
      config: {
        name: "exemplo",
        profiles: [{ nome: "Edgar", papel: "po" }],
        people: [{ id: "edgar", perfis: ["Edgar"] }],
      },
    });
    await completarConfiguracao(f, [{ id: "edgar", perfis: ["Edgar"] }, TECH_LEAD]);

    expect(await api<string[]>(f, "GET", "/projetos/exemplo/pendencias")).toEqual([]);
  });

  it("um perfil PO sem nenhuma pessoa atribuída gera pendência", async () => {
    f = await startTestFactory({
      config: { name: "exemplo", profiles: [{ nome: "Edgar", papel: "po" }], people: [] },
    });
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");
    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...atual,
      source: { type: "github", project: "PROJ", repo: "dono/repo", assignee: "dono" },
    });

    const pendencias = await api<string[]>(f, "GET", "/projetos/exemplo/pendencias");

    expect(pendencias.some((p) => /PO/.test(p))).toBe(true);
  });

  it("avisa quando a Fonte Jira não tem credencial no cofre", async () => {
    f = await startTestFactory({ config: { name: "exemplo" } });

    const pendencias = await api<string[]>(f, "GET", "/projetos/exemplo/pendencias");

    expect(pendencias.some((p) => /credencial/i.test(p))).toBe(true);
  });

  it("avisa quando não há ninguém no perfil tech lead", async () => {
    f = await startTestFactory({ config: { name: "exemplo", people: [] } });
    await completarConfiguracao(f, [PO]);

    const pendencias = await api<string[]>(f, "GET", "/projetos/exemplo/pendencias");

    expect(pendencias.some((p) => /tech lead/.test(p))).toBe(true);
  });

  it("avisa quando o projeto não tem repositório", async () => {
    f = await startTestFactory({ config: { name: "exemplo", people: [PO, TECH_LEAD] } });
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");
    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...atual,
      source: { type: "github", project: "PROJ", repo: "dono/repo", assignee: "dono" },
      repositories: [],
    });

    const pendencias = await api<string[]>(f, "GET", "/projetos/exemplo/pendencias");

    expect(pendencias.some((p) => /repositório/.test(p))).toBe(true);
  });

  it("sem pendências, a lista vem vazia", async () => {
    f = await startTestFactory({ config: { name: "exemplo", people: [] } });
    await completarConfiguracao(f, [PO, TECH_LEAD]);

    expect(await api<string[]>(f, "GET", "/projetos/exemplo/pendencias")).toEqual([]);
  });

  it("estado: projeto sem pendências é ativo, com lista vazia", async () => {
    f = await startTestFactory({ config: { name: "exemplo", people: [] } });
    await completarConfiguracao(f, [PO, TECH_LEAD]);

    expect(await api(f, "GET", "/projetos/exemplo/estado")).toEqual({ estado: "ativo", pendencias: [] });
  });

  it("estado: projeto com pendências é incompleto e lista o que falta", async () => {
    f = await startTestFactory({ config: { name: "exemplo", people: [] } });

    const situacao = await api<{ estado: string; pendencias: string[] }>(f, "GET", "/projetos/exemplo/estado");

    expect(situacao.estado).toBe("incompleto");
    expect(situacao.pendencias.length).toBeGreaterThan(0);
  });

  it("avisa quando o repositório não tem comando de teste", async () => {
    f = await startTestFactory({ config: { name: "exemplo", people: [PO, TECH_LEAD] } });
    await completarConfiguracao(f, [PO, TECH_LEAD]);
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");
    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...atual,
      repositories: [{ path: process.cwd(), prefix: "EX", test: { command: [] } }],
    });

    expect(await api<string[]>(f, "GET", "/projetos/exemplo/pendencias")).toEqual(["falta o comando de teste"]);
  });

  it("avisa quando não há provedor permitido, e o projeto só fica ativo depois de autorizar um", async () => {
    f = await startTestFactory({ config: { name: "exemplo", people: [] } });
    await completarConfiguracao(f, [PO, TECH_LEAD]);
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");
    await api(f, "PUT", "/projetos/exemplo/configuracao", { ...atual, allowedProviders: [] });

    expect(await api(f, "GET", "/projetos/exemplo/estado")).toEqual({
      estado: "incompleto",
      pendencias: ["falta um provedor permitido"],
    });

    await api(f, "PUT", "/projetos/exemplo/configuracao", { ...atual, allowedProviders: ["anthropic"] });
    expect(await api(f, "GET", "/projetos/exemplo/estado")).toEqual({ estado: "ativo", pendencias: [] });
  });

  it("comando de formatação é opcional e não vira pendência", async () => {
    f = await startTestFactory({ config: { name: "exemplo", people: [] } });
    await completarConfiguracao(f, [PO, TECH_LEAD]);
    const atual = await api<{ repositories: Record<string, unknown>[] }>(f, "GET", "/projetos/exemplo/configuracao");
    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...atual,
      repositories: atual.repositories.map((r) => ({ ...r, format: undefined })),
    });

    expect(await api<string[]>(f, "GET", "/projetos/exemplo/pendencias")).toEqual([]);
  });

  it("remover o último PO de um projeto ativo o torna incompleto, com a pendência", async () => {
    f = await startTestFactory({ config: { name: "exemplo", people: [] } });
    await completarConfiguracao(f, [PO, TECH_LEAD]);
    expect(await api(f, "GET", "/projetos/exemplo/estado")).toEqual({ estado: "ativo", pendencias: [] });

    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");
    await api(f, "PUT", "/projetos/exemplo/configuracao", { ...atual, people: [TECH_LEAD] });

    expect(await api(f, "GET", "/projetos/exemplo/estado")).toEqual({
      estado: "incompleto",
      pendencias: ["falta uma pessoa no perfil PO"],
    });
  });

  it("estado de projeto inexistente responde 404", async () => {
    f = await startTestFactory({ config: { name: "exemplo" } });

    const resposta = await fetch(`${f.url}/projetos/nao-existe/estado`);

    expect(resposta.status).toBe(404);
  });
});
