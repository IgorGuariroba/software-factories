import { afterEach, describe, expect, it } from "vitest";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";
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

describe("falhas ao assumir", () => {
  it("se a transição falha, o próximo poll não comenta 'Assumindo' de novo e completa a transição", async () => {
    factory = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER }],
    });
    const source = factory.source;
    const transition = source.transition.bind(source);
    let failures = 1;
    source.transition = async (key, status) => {
      if (failures-- > 0) throw new Error("Jira fora do ar");
      return transition(key, status);
    };

    const first = await fetch(`${factory.url}/poll`, { method: "POST" });
    await poll(factory);

    expect(first.status).toBe(500);
    expect(source.commentsOf("PROJ-1")).toHaveLength(1);
    expect(source.cards[0]?.status).toBe("Em Andamento");
  });

  it("um erro num card não impede que os outros sejam assumidos no mesmo poll", async () => {
    factory = await startTestFactory({
      cards: [
        { key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER },
        { key: "PROJ-2", title: "t", status: "A Fazer", assignee: USER },
      ],
    });
    const source = factory.source;
    const addComment = source.addComment.bind(source);
    source.addComment = async (key, body) => {
      if (key === "PROJ-1") throw new Error("Jira fora do ar");
      return addComment(key, body);
    };

    await fetch(`${factory.url}/poll`, { method: "POST" });

    expect(source.commentsOf("PROJ-2")).toHaveLength(1);
    expect(source.cards[1]?.status).toBe("Em Andamento");
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

  it("a busca automática ignora os ticks enquanto um poll ainda está em andamento", async () => {
    const source = new MemoryDemandSource();
    source.latencyMs = 40;
    let polls = 0;
    const list = source.listAssignedCards.bind(source);
    source.listAssignedCards = async (assignee) => {
      polls++;
      return list(assignee);
    };
    factory = await startTestFactory({ source, pollIntervalMs: 5 });

    await new Promise((resolve) => setTimeout(resolve, 150));
    await factory.close();
    factory = undefined;

    // ~150 ms / 40 ms por busca: sem acumular, no máximo uma busca por janela de 40 ms.
    expect(polls).toBeLessThanOrEqual(5);
  });
});
