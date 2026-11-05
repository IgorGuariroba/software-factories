import { afterEach, describe, expect, it } from "vitest";
import { startTestFactory, type TestFactory, USER } from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const poll = async (f: TestFactory) => {
  const res = await fetch(`${f.url}/poll`, { method: "POST" });
  expect(res.status).toBe(200);
};
const events = async (f: TestFactory) => (await (await fetch(`${f.url}/events`)).json()) as Record<string, unknown>[];

describe("assumir card 'A Fazer'", () => {
  it("comenta que está assumindo e move o card para 'Em Andamento'", async () => {
    factory = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER }],
    });

    await poll(factory);

    expect(factory.source.commentsOf("PROJ-1").map((c) => c.body)).toEqual(["🤖 [fábrica] Assumindo este card."]);
    expect(factory.source.cards[0]?.status).toBe("Em Andamento");
    expect(await events(factory)).toMatchObject([
      { type: "write", target: "PROJ-1", action: "comment" },
      { type: "write", target: "PROJ-1", action: "transition", content: "Em Andamento" },
    ]);
  });

  it("não assume de novo um card que já assumiu", async () => {
    factory = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER }],
    });

    await poll(factory);
    await poll(factory);

    expect(factory.source.commentsOf("PROJ-1")).toHaveLength(1);
  });

  it("ainda não assume cards que já estavam 'Em Andamento' (veto chega na M1-05)", async () => {
    factory = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "t", status: "Em Andamento", assignee: USER }],
    });

    await poll(factory);

    expect(factory.source.commentsOf("PROJ-1")).toEqual([]);
  });

  it("no dry-run não escreve no card, mas mostra as escritas na API", async () => {
    factory = await startTestFactory({
      dryRun: true,
      cards: [{ key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER }],
    });

    await poll(factory);
    await poll(factory);

    expect(factory.source.commentsOf("PROJ-1")).toEqual([]);
    expect(factory.source.cards[0]?.status).toBe("A Fazer");
    expect(await events(factory)).toMatchObject([
      { type: "write", action: "comment", content: "🤖 [fábrica] Assumindo este card.", dryRun: true },
      { type: "write", action: "transition", content: "Em Andamento", dryRun: true },
    ]);
  });

  it("não assume um card reatribuído a outra pessoa entre a leitura e a escrita, e registra o bloqueio", async () => {
    factory = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER }],
    });
    const source = factory.source;
    const original = source.getCard.bind(source);
    source.getCard = async (key) => {
      const card = await original(key);
      return card && { ...card, assignee: "maria" };
    };

    await poll(factory);

    expect(source.commentsOf("PROJ-1")).toEqual([]);
    expect(await events(factory)).toMatchObject([{ type: "blocked", target: "PROJ-1", action: "comment" }]);
  });
});

describe("buscas simultâneas", () => {
  it("dois POST /poll ao mesmo tempo assumem o card uma única vez", async () => {
    factory = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER }],
    });
    factory.source.latencyMs = 10;

    await Promise.all([poll(factory), poll(factory)]);

    expect(factory.source.commentsOf("PROJ-1")).toHaveLength(1);
  });
});
