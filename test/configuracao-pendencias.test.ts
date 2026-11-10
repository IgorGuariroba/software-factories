import { afterEach, describe, expect, it } from "vitest";
import { api, startTestFactory, type TestFactory } from "./harness.js";

describe("pendências de configuração (fatia 11)", () => {
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

  it("avisa quando a Fonte Jira não tem credencial no cofre", async () => {
    f = await startTestFactory({ config: { name: "exemplo" } });

    const pendencias = await api<string[]>(f, "GET", "/projetos/exemplo/pendencias");

    expect(pendencias.some((p) => /credencial/i.test(p))).toBe(true);
  });

  it("sem pendências, a lista vem vazia", async () => {
    f = await startTestFactory({ config: { name: "exemplo", people: [{ id: "po-x", role: "po" }] } });
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");
    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...atual,
      source: { type: "github", project: "PROJ", repo: "dono/repo", assignee: "dono" },
    });

    const pendencias = await api<string[]>(f, "GET", "/projetos/exemplo/pendencias");

    expect(pendencias).toEqual([]);
  });
});
