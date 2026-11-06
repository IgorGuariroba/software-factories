import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "./fakes/fake-clock.js";
import {
  assumeComments,
  events,
  eventually,
  poll,
  startTestFactory,
  statusOf,
  type TestFactory,
  USER,
  waitForStatus,
} from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const START = "2026-11-10T10:00:00-03:00";
const card = (key: string, status: string) => ({ key, title: `Ajustar filtro ${key}`, status, assignee: USER });
/** Deixa a fábrica reagir (ex.: ao que o relógio falso disparou) antes de conferir que algo *não* aconteceu. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const notices = async (f: TestFactory) => (await events(f)).filter((e) => e.type === "notify");
/** Comentários da fábrica no card além do de assunção (SPEC, Tickets, …). */
const otherFactoryComments = (f: TestFactory, key: string) =>
  f.source.commentsOf(key).filter((c) => c.author === USER && !c.body.startsWith("Assumindo este card."));

async function startWith(cards: ReturnType<typeof card>[], config: { vetoMinutes?: number } = {}) {
  const clock = new FakeClock(START);
  factory = await startTestFactory({ cards, clock, config });
  return { clock, f: factory };
}

describe("assumir card 'Em Andamento' com veto", () => {
  it("comenta que está assumindo, avisa o usuário e aguarda o veto sem seguir para as etapas", async () => {
    const { f } = await startWith([card("PROJ-1", "Em Andamento")]);

    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");

    expect(assumeComments(f.source, "PROJ-1").map((c) => c.body)).toEqual([
      "Assumindo este card.\n\n*mensagem automatizada*",
    ]);
    expect(await notices(f)).toMatchObject([
      { type: "notify", target: "PROJ-1", reason: "aguardando-veto", until: "2026-11-10T13:30:00.000Z" },
    ]);
    await settle();
    expect(otherFactoryComments(f, "PROJ-1")).toEqual([]);
    expect(f.model.calls).toEqual([]);
  });

  it("sem veto, a tarefa dorme 30 min no relógio da fábrica e então segue para as etapas sem mover o card", async () => {
    const { clock, f } = await startWith([card("PROJ-1", "Em Andamento")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");

    clock.advanceTo("2026-11-10T10:29:59-03:00");
    await settle();
    expect(await statusOf(f, "PROJ-1")).toBe("aguardando-veto");
    expect(f.model.calls).toEqual([]);

    clock.advanceTo("2026-11-10T10:30:00-03:00");
    await waitForStatus(f, "PROJ-1", "concluida");
    expect(f.model.calls).toHaveLength(1);
    expect(otherFactoryComments(f, "PROJ-1").length).toBeGreaterThan(0);
    expect(f.source.cards[0]?.status).toBe("Em Andamento");
    expect((await events(f)).filter((e) => e.type === "write" && e.action === "transition")).toEqual([]);
  });
});

describe("veto", () => {
  const veto = (f: TestFactory, key: string) => fetch(`${f.url}/tasks/exemplo/${key}/veto`, { method: "POST" });

  it("dentro do prazo, deixa a tarefa vetada e ela não age mais no card", async () => {
    const { clock, f } = await startWith([card("PROJ-1", "Em Andamento")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");
    const before = f.source.commentsOf("PROJ-1").length;

    clock.advanceTo("2026-11-10T10:20:00-03:00");
    const res = await veto(f, "PROJ-1");

    expect(res.status).toBe(200);
    await waitForStatus(f, "PROJ-1", "vetada");
    clock.advanceTo("2026-11-10T12:00:00-03:00");
    await poll(f);
    await settle();
    expect(await statusOf(f, "PROJ-1")).toBe("vetada");
    expect(f.source.commentsOf("PROJ-1")).toHaveLength(before);
    expect(f.model.calls).toEqual([]);
    expect(await events(f)).toContainEqual(
      expect.objectContaining({ type: "task", key: "PROJ-1", status: "vetada", reason: "vetada pelo usuário" }),
    );
  });

  it("depois do prazo responde 409 e não tem efeito", async () => {
    const { clock, f } = await startWith([card("PROJ-1", "Em Andamento")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");

    clock.advanceTo("2026-11-10T10:30:00-03:00");
    const res = await veto(f, "PROJ-1");

    expect(res.status).toBe(409);
    await waitForStatus(f, "PROJ-1", "concluida");
  });

  it("numa tarefa que não passa por veto responde 409; numa inexistente, 404", async () => {
    const { f } = await startWith([card("PROJ-1", "A Fazer")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "concluida");

    expect((await veto(f, "PROJ-1")).status).toBe(409);
    expect(await statusOf(f, "PROJ-1")).toBe("concluida");
    expect((await veto(f, "PROJ-9")).status).toBe(404);
    expect(await notices(f)).toEqual([]);
  });

  it("vale só para clientes locais, como as outras rotas", async () => {
    const { f } = await startWith([card("PROJ-1", "Em Andamento")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");

    const res = await fetch(`${f.url}/tasks/exemplo/PROJ-1/veto`, {
      method: "POST",
      headers: { origin: "http://site-qualquer.example" },
    });

    expect(res.status).toBe(403);
    expect(await statusOf(f, "PROJ-1")).toBe("aguardando-veto");
  });

  it("é o mesmo comando que as interfaces de gestão chamam", async () => {
    const { f } = await startWith([card("PROJ-1", "Em Andamento")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");

    expect(await f.commands.veto("exemplo/PROJ-1")).toBe("vetada");
    await waitForStatus(f, "PROJ-1", "vetada");
    expect(await f.commands.veto("exemplo/PROJ-1")).toBe("fora-do-prazo");
  });
});

describe("espera do veto", () => {
  it("enquanto uma tarefa espera o veto, a fila segue", async () => {
    const { f } = await startWith([card("PROJ-1", "Em Andamento"), card("PROJ-2", "A Fazer")]);

    await poll(f);

    await waitForStatus(f, "PROJ-2", "concluida");
    expect(await statusOf(f, "PROJ-1")).toBe("aguardando-veto");
    expect(f.source.cards[1]?.status).toBe("Em Andamento");
  });

  it("sobrevive a um reinício: o prazo continua e o aviso não se repete", async () => {
    const { clock, f } = await startWith([card("PROJ-1", "Em Andamento")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");

    factory = await f.restart();
    await waitForStatus(factory, "PROJ-1", "aguardando-veto");
    clock.advanceTo("2026-11-10T10:30:00-03:00");

    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(assumeComments(factory.source, "PROJ-1")).toHaveLength(1);
    expect(await notices(factory)).toHaveLength(1);
  });

  it("o veto também vale depois de um reinício, dentro do prazo", async () => {
    const { clock, f } = await startWith([card("PROJ-1", "Em Andamento")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");

    factory = await f.restart();
    await waitForStatus(factory, "PROJ-1", "aguardando-veto");
    expect(await factory.commands.veto("exemplo/PROJ-1")).toBe("vetada");
    clock.advanceTo("2026-11-10T11:00:00-03:00");
    await settle();

    expect(await statusOf(factory, "PROJ-1")).toBe("vetada");
    expect(factory.model.calls).toEqual([]);
  });

  it("o prazo é configurável por projeto", async () => {
    const { clock, f } = await startWith([card("PROJ-1", "Em Andamento")], { vetoMinutes: 5 });
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");
    expect(await notices(f)).toMatchObject([{ until: "2026-11-10T13:05:00.000Z" }]);

    clock.advanceTo("2026-11-10T10:05:00-03:00");

    await waitForStatus(f, "PROJ-1", "concluida");
  });

  it("pausada enquanto espera o veto, segue só depois de retomada", async () => {
    const { clock, f } = await startWith([card("PROJ-1", "Em Andamento")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");

    await fetch(`${f.url}/tasks/exemplo/PROJ-1/pause`, { method: "POST" });
    clock.advanceTo("2026-11-10T10:30:00-03:00");
    await waitForStatus(f, "PROJ-1", "pausada");
    await settle();
    expect(f.model.calls).toEqual([]);

    await fetch(`${f.url}/tasks/exemplo/PROJ-1/resume`, { method: "POST" });
    await waitForStatus(f, "PROJ-1", "concluida");
  });

  it("uma falha depois do prazo tenta de novo sem abrir outro prazo de veto", async () => {
    const { clock, f } = await startWith([card("PROJ-1", "Em Andamento")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");
    const getCard = f.source.getCard.bind(f.source);
    let failures = 1;
    f.source.getCard = async (key) => {
      if (failures-- > 0) throw new Error("Jira fora do ar");
      return getCard(key);
    };

    clock.advanceTo("2026-11-10T10:30:00-03:00");
    await eventually(async () => expect(await events(f)).toContainEqual(expect.objectContaining({ type: "error" })));
    clock.advanceTo("2026-11-10T10:31:00-03:00");

    await waitForStatus(f, "PROJ-1", "concluida");
    expect(await notices(f)).toHaveLength(1);
    expect(assumeComments(f.source, "PROJ-1")).toHaveLength(1);
  });

  it("no dry-run a assunção só aparece como escrita registrada, e o prazo de veto vale igual", async () => {
    const clock = new FakeClock(START);
    factory = await startTestFactory({ cards: [card("PROJ-1", "Em Andamento")], clock, dryRun: true });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-veto");

    expect(factory.source.commentsOf("PROJ-1")).toEqual([]);
    expect(await events(factory)).toContainEqual(
      expect.objectContaining({
        type: "write",
        action: "comment",
        content: "Assumindo este card.\n\n*mensagem automatizada*",
      }),
    );
    expect(await notices(factory)).toHaveLength(1);
  });
});
