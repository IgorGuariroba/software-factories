import { afterEach, describe, expect, it } from "vitest";
import { api, startTestFactory, type TestFactory } from "./harness.js";

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

  it("responde 404 para o histórico de um projeto que não existe", async () => {
    f = await startTestFactory({});

    const res = await fetch(`${f.url}/projetos/inexistente/historico`);

    expect(res.status).toBe(404);
  });
});
