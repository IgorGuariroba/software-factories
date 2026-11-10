import { afterEach, describe, expect, it } from "vitest";
import { api, startTestFactory, type TestFactory } from "./harness.js";

// ADR-0017: o YAML só semeia o estado durável na primeira execução. Depois disso, o estado manda.
describe("configuração de projeto: semente do YAML e estado durável", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("grava o projeto do YAML na primeira execução e a API o devolve", async () => {
    f = await startTestFactory({ config: { name: "exemplo", dryRun: true } });

    const config = await api<{ name: string; dryRun: boolean }>(f, "GET", "/projetos/exemplo/configuracao");

    expect(config).toMatchObject({ name: "exemplo", dryRun: true });
  });

  it("uma mudança no YAML depois da semente não sobrescreve a configuração guardada", async () => {
    f = await startTestFactory({ config: { name: "exemplo", dryRun: true } });
    // Reinício com o YAML alterado (dryRun: false) sobre o mesmo estado durável.
    f = await f.restartComYaml({ name: "exemplo", dryRun: false });

    const config = await api<{ dryRun: boolean }>(f, "GET", "/projetos/exemplo/configuracao");
    expect(config.dryRun).toBe(true);
  });

  it("responde 404 para um projeto que não existe", async () => {
    f = await startTestFactory({ config: { name: "exemplo" } });

    const res = await fetch(`${f.url}/projetos/inexistente/configuracao`);

    expect(res.status).toBe(404);
  });
});
