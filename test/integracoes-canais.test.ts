import { afterEach, describe, expect, it } from "vitest";
import { api, startTestFactory, type TestFactory } from "./harness.js";

// Fatia 01: os tipos de Canal são registrados pelo mesmo mecanismo das Fontes, e a API os lista.
describe("tipos de Canal registrados", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("lista o comentário no card (conversa) e o aviso no Teams, cada um com o papel que cumpre", async () => {
    f = await startTestFactory({});

    const canais = await api<{ tipo: string; papel: "conversa" | "aviso" }[]>(f, "GET", "/integracoes/canais");

    expect(canais).toEqual(
      expect.arrayContaining([
        { tipo: "card-comment", papel: "conversa", rotulo: expect.any(String) },
        { tipo: "teams", papel: "aviso", rotulo: expect.any(String) },
      ]),
    );
  });
});
