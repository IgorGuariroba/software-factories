import { afterEach, describe, expect, it } from "vitest";
import { api, startTestFactory, type TestFactory } from "./harness.js";

describe("lista de projetos para a interface", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("lista os projetos carregados, com a Fonte e o estado do ensaio", async () => {
    f = await startTestFactory({ config: { name: "exemplo", dryRun: true } });

    const lista = await api<{ nome: string; fonte: string; ensaio: boolean }[]>(f, "GET", "/projetos");

    expect(lista).toEqual([{ nome: "exemplo", fonte: "jira", ensaio: true }]);
  });
});
