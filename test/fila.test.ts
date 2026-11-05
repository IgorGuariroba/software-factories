import { afterEach, describe, expect, it } from "vitest";
import { startTestFactory, type TestFactory } from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

describe("fila de cards elegíveis", () => {
  it("mostra na API o card atribuído ao usuário em 'A Fazer'", async () => {
    factory = await startTestFactory({
      cards: [{ key: "SNPSM-1", title: "[VETOR SN] Ajustar filtro", status: "A Fazer", assignee: "igor" }],
    });

    const res = await fetch(`${factory.url}/queue`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { project: "exemplo", key: "SNPSM-1", title: "[VETOR SN] Ajustar filtro", status: "A Fazer", state: "todo" },
    ]);
  });

  it("ignora backlog, cards de outra pessoa e cards que já saíram de 'Em Andamento'", async () => {
    factory = await startTestFactory({
      cards: [
        { key: "P-1", title: "no backlog", status: "Backlog", assignee: "igor" },
        { key: "P-2", title: "de outra pessoa", status: "A Fazer", assignee: "maria" },
        { key: "P-3", title: "em teste", status: "Aguardando Teste", assignee: "igor" },
        { key: "P-4", title: "status desconhecido", status: "Bloqueado", assignee: "igor" },
        { key: "P-5", title: "em andamento", status: "Em Andamento", assignee: "igor" },
      ],
    });

    const keys = ((await (await fetch(`${factory.url}/queue`)).json()) as { key: string }[]).map((c) => c.key);

    expect(keys).toEqual(["P-5"]);
  });

  it("só escuta em localhost", async () => {
    factory = await startTestFactory();

    expect(new URL(factory.url).hostname).toBe("127.0.0.1");
  });

  it("responde 500 com o erro quando a Fonte falha", async () => {
    factory = await startTestFactory();
    factory.source.listAssignedCards = async () => {
      throw new Error("Jira fora do ar");
    };

    const res = await fetch(`${factory.url}/queue`);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error: Jira fora do ar" });
  });
});
