import { afterEach, describe, expect, it } from "vitest";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";
import { events, eventually, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

describe("assumir card 'A Fazer'", () => {
  it("comenta que está assumindo e move o card para 'Em Andamento'", async () => {
    factory = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER }],
    });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    expect(factory.source.commentsOf("PROJ-1").map((c) => c.body)).toEqual(["🤖 [fábrica] Assumindo este card."]);
    expect(factory.source.cards[0]?.status).toBe("Em Andamento");
    expect((await events(factory)).filter((e) => e.type === "write")).toMatchObject([
      { type: "write", target: "PROJ-1", action: "comment" },
      { type: "write", target: "PROJ-1", action: "transition", content: "Em Andamento" },
    ]);
  });

  it("não assume de novo um card que já assumiu", async () => {
    factory = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER }],
    });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    const returned = factory.source.cards[0];
    if (returned) returned.status = "A Fazer"; // alguém devolve o card
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

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
    await waitForStatus(factory, "PROJ-1", "concluida");
    await poll(factory);

    expect(factory.source.commentsOf("PROJ-1")).toEqual([]);
    expect(factory.source.cards[0]?.status).toBe("A Fazer");
    expect((await events(factory)).filter((e) => e.type === "write")).toMatchObject([
      { type: "write", action: "comment", content: "🤖 [fábrica] Assumindo este card.", dryRun: true },
      { type: "write", action: "transition", content: "Em Andamento", dryRun: true },
    ]);
  });

  it("um card reatribuído a outra pessoa entre a leitura e a escrita fica bloqueado, sem nova tentativa", async () => {
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
    await waitForStatus(factory, "PROJ-1", "bloqueada");
    await poll(factory);

    expect(source.commentsOf("PROJ-1")).toEqual([]);
    expect((await events(factory)).filter((e) => e.type === "blocked")).toMatchObject([
      { type: "blocked", target: "PROJ-1", action: "comment" },
    ]);
  });
});

describe("falhas ao assumir", () => {
  it("se a transição falha, a tarefa é tentada de novo sem comentar 'Assumindo' outra vez", async () => {
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

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    expect(source.commentsOf("PROJ-1")).toHaveLength(1);
    expect(source.cards[0]?.status).toBe("Em Andamento");
    expect(await events(factory)).toContainEqual(
      expect.objectContaining({ type: "error", target: "PROJ-1", message: expect.stringMatching(/Jira fora do ar/) }),
    );
  });

  it("um card com erro volta para o fim da fila e não impede os outros", async () => {
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

    await poll(factory);
    await waitForStatus(factory, "PROJ-2", "concluida");

    expect(source.commentsOf("PROJ-2")).toHaveLength(1);
    expect(source.cards[1]?.status).toBe("Em Andamento");
  });
});

describe("buscas", () => {
  it("dois POST /poll ao mesmo tempo enfileiram o card uma única vez", async () => {
    factory = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER }],
    });
    factory.source.latencyMs = 10;

    await Promise.all([poll(factory), poll(factory)]);
    await waitForStatus(factory, "PROJ-1", "concluida");

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

  it("a busca automática assume cards sem POST /poll", async () => {
    factory = await startTestFactory({
      pollIntervalMs: 10,
      cards: [{ key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER }],
    });

    await eventually(() => expect(factory?.source.cards[0]?.status).toBe("Em Andamento"));
  });
});
