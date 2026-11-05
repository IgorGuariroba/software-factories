import { afterEach, describe, expect, it } from "vitest";
import type { Card } from "../src/demand-source.js";
import { FakeClock } from "./fakes/fake-clock.js";
import { askPo, DEFAULT_SPEC, deliverSpec, FakeModel } from "./fakes/fake-model.js";
import { FakeTelegram, TELEGRAM_CHAT } from "./fakes/fake-telegram.js";
import {
  api,
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

const card = (key: string, status: string, title = `Ajustar filtro ${key}`): Card => ({
  key,
  title,
  status,
  assignee: USER,
});

const START = "2026-11-10T10:00:00-03:00";
/** Deixa a fábrica reagir antes de conferir que algo *não* aconteceu. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const commandEvents = async (f: TestFactory) => (await events(f)).filter((e) => e.type === "command");

async function startWith(cards: Card[], opts: Parameters<typeof startTestFactory>[0] = {}) {
  const telegram = new FakeTelegram();
  const clock = new FakeClock(START);
  factory = await startTestFactory({ cards, telegram, clock, ...opts });
  return { telegram, clock, f: factory };
}

describe("Telegram: eventos ao usuário", () => {
  it("avisa quando assume um card, com o título", async () => {
    const telegram = new FakeTelegram();
    factory = await startTestFactory({ cards: [card("PROJ-1", "A Fazer")], telegram });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    await eventually(() =>
      expect(telegram.texts()).toContainEqual(expect.stringMatching(/Assumi o card PROJ-1.*Ajustar filtro PROJ-1/)),
    );
  });
});

describe("Telegram: veto", () => {
  it("o aviso de prazo de veto vem com o botão Vetar, e tocá-lo veta a tarefa", async () => {
    const { telegram, f } = await startWith([card("PROJ-1", "Em Andamento")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");
    await eventually(() => expect(telegram.texts()).toContainEqual(expect.stringMatching(/PROJ-1.*vetar/i)));
    expect(telegram.texts().filter((t) => t.startsWith("Assumi"))).toEqual([]);

    const tap = telegram.tap(telegram.button("Vetar"));

    await waitForStatus(f, "PROJ-1", "vetada");
    await eventually(() =>
      expect(telegram.answers).toContainEqual({ buttonId: tap, text: expect.stringMatching(/vetada/) }),
    );
    expect(f.model.calls).toEqual([]);
  });

  it("/vetar por texto responde no chat; fora do prazo, responde que não há o que vetar", async () => {
    const { telegram, clock, f } = await startWith([card("PROJ-1", "Em Andamento"), card("PROJ-2", "Em Andamento")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");
    await waitForStatus(f, "PROJ-2", "aguardando-veto");

    telegram.say("/vetar PROJ-1");
    await waitForStatus(f, "PROJ-1", "vetada");
    await eventually(() =>
      expect(telegram.texts()).toContain("Tarefa exemplo/PROJ-1 vetada: ela não age mais no card."),
    );

    clock.advanceTo("2026-11-10T10:30:00-03:00");
    await waitForStatus(f, "PROJ-2", "concluida");
    telegram.say("/vetar exemplo/PROJ-2");
    await eventually(() =>
      expect(telegram.texts()).toContain(
        "A Tarefa exemplo/PROJ-2 não está aguardando veto (o prazo já passou ou não houve).",
      ),
    );
    expect(await statusOf(f, "PROJ-2")).toBe("concluida");
  });
});

describe("Telegram: pausar e retomar", () => {
  it("pausa e retoma o daemon e uma tarefa, com resposta a cada comando", async () => {
    const { telegram, f } = await startWith([card("PROJ-1", "A Fazer")]);

    telegram.say("/pausar");
    await eventually(async () => expect(await api(f, "GET", "/daemon")).toEqual({ paused: true }));
    await poll(f);
    telegram.say("/pausar PROJ-1");
    await waitForStatus(f, "PROJ-1", "pausada");

    telegram.say("/retomar");
    await eventually(async () => expect(await api(f, "GET", "/daemon")).toEqual({ paused: false }));
    await settle();
    expect(await statusOf(f, "PROJ-1")).toBe("pausada");

    telegram.say("/retomar PROJ-1");
    await waitForStatus(f, "PROJ-1", "concluida");
    await eventually(() =>
      expect(telegram.texts()).toEqual(
        expect.arrayContaining([
          "Daemon pausado: nenhuma Tarefa nova começa.",
          "Pausa pedida para a Tarefa exemplo/PROJ-1.",
          "Daemon retomado.",
          "Tarefa exemplo/PROJ-1 retomada.",
        ]),
      ),
    );
  });

  it("aceita sequência menor após uma semana sem comandos, inclusive após reinício", async () => {
    let { telegram, clock, f } = await startWith([]);
    telegram.say("/pausar");
    await eventually(async () => expect(await api(f, "GET", "/daemon")).toEqual({ paused: true }));
    telegram.say("/retomar");
    await eventually(async () => expect(await api(f, "GET", "/daemon")).toEqual({ paused: false }));
    f = await f.restart();
    factory = f;
    clock.advanceTo(new Date(clock.now() + 7 * 24 * 60 * 60 * 1000 + 1));
    telegram.resetSequence(1);
    telegram.say("/pausar");
    await eventually(async () => expect(await api(f, "GET", "/daemon")).toEqual({ paused: true }));
  });

  it("o aviso de que assumiu traz o botão Pausar", async () => {
    const { telegram, f } = await startWith([card("PROJ-1", "A Fazer")]);
    await poll(f);
    await eventually(() => expect(telegram.button("Pausar").command).toBe("/pausar exemplo/PROJ-1"));
  });

  it("comando desconhecido ou card inexistente recebem ajuda, sem efeito", async () => {
    const { telegram, f } = await startWith([card("PROJ-1", "A Fazer")]);
    telegram.say("/pausar");
    await eventually(async () => expect(await api(f, "GET", "/daemon")).toEqual({ paused: true }));
    await poll(f);

    telegram.say("/apagar-tudo");
    telegram.say("/pausar PROJ-9");

    await eventually(() =>
      expect(telegram.texts()).toEqual(
        expect.arrayContaining([expect.stringMatching(/^Comandos:/), "Não achei a Tarefa PROJ-9."]),
      ),
    );
    expect(await statusOf(f, "PROJ-1")).toBe("enfileirada");
  });
});

describe("Telegram: só o usuário configurado comanda", () => {
  it("comandos e botões de outro chat ou outro usuário são ignorados e registrados", async () => {
    const { telegram, f } = await startWith([card("PROJ-1", "Em Andamento")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-veto");
    await eventually(() => expect(telegram.button("Vetar")).toBeDefined());
    const sentBefore = telegram.sent.length;

    telegram.say("/vetar PROJ-1", { chat: "9999", user: "9999" });
    telegram.say("/pausar", { chat: TELEGRAM_CHAT, user: "3003" });
    telegram.tap(telegram.button("Vetar"), { chat: "9999", user: "9999" });

    await eventually(async () => expect(await commandEvents(f)).toHaveLength(3));
    expect(await commandEvents(f)).toEqual([
      expect.objectContaining({ via: "telegram", chat: "9999", user: "9999", text: "/vetar PROJ-1", accepted: false }),
      expect.objectContaining({ chat: TELEGRAM_CHAT, user: "3003", text: "/pausar", accepted: false }),
      expect.objectContaining({ chat: "9999", text: "/vetar exemplo/PROJ-1", accepted: false }),
    ]);
    await settle();
    expect(await statusOf(f, "PROJ-1")).toBe("aguardando-veto");
    expect(await api(f, "GET", "/daemon")).toEqual({ paused: false });
    expect(telegram.sent).toHaveLength(sentBefore);
    expect(telegram.answers).toEqual([]);
  });

  it("os comandos aceitos também ficam registrados", async () => {
    const { telegram, f } = await startWith([]);
    telegram.say("/pausar");
    await eventually(async () =>
      expect(await commandEvents(f)).toEqual([
        expect.objectContaining({ text: "/pausar", accepted: true, result: expect.stringMatching(/Daemon pausado/) }),
      ]),
    );
  });
});

describe("Telegram: bloqueios e avisos", () => {
  it("avisa quando a tarefa fica bloqueada, com o motivo", async () => {
    const { telegram, f } = await startWith([{ ...card("PROJ-1", "A Fazer"), description: undefined }], {
      config: { people: [] },
    });
    await poll(f);
    await waitForStatus(f, "PROJ-1", "bloqueada");

    await eventually(() =>
      expect(telegram.texts()).toContainEqual(
        expect.stringMatching(/^A Tarefa PROJ-1 \(exemplo\) está bloqueada: .*não declara um/),
      ),
    );
  });

  it("avisa quando um guardrail bloqueia uma escrita", async () => {
    const { telegram, f } = await startWith([card("PROJ-1", "A Fazer")]);
    const getCard = f.source.getCard.bind(f.source);
    f.source.getCard = async (key) => {
      const found = await getCard(key);
      return found && { ...found, assignee: "maria" };
    };
    await poll(f);
    await waitForStatus(f, "PROJ-1", "bloqueada");

    await eventually(() =>
      expect(telegram.texts()).toContainEqual(
        expect.stringMatching(/^Guardrail bloqueou comment em PROJ-1 \(exemplo\): /),
      ),
    );
  });

  it("encaminha o aviso de pergunta sem resposta, sem os segredos que vierem no texto", async () => {
    const model = new FakeModel();
    model.respond = (call) =>
      call.input.includes("Resposta do PO")
        ? deliverSpec(DEFAULT_SPEC)
        : askPo(`O acesso ao banco é DB_PASSWORD=${"hunter"}2segredo mesmo?`);
    const { telegram, clock, f } = await startWith([card("PROJ-1", "A Fazer")], { model });
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-humano");

    clock.advanceTo("2026-11-11T13:00:00Z");

    await eventually(() =>
      expect(telegram.texts()).toContainEqual(
        expect.stringMatching(/^Aviso: A pergunta 1 ao PO no card PROJ-1 .*DB_PASSWORD=\[segredo removido\] mesmo\?/),
      ),
    );
    expect(telegram.texts().join("\n")).not.toContain("2segredo");
  });
});

describe("Telegram: conteúdo", () => {
  const secretTitle = `Configurar integração com api_key: ${"abc"}123segredo`;

  it("no nível full manda o texto completo, sempre pelo filtro de segredos", async () => {
    const { telegram, f } = await startWith([card("PROJ-1", "A Fazer", secretTitle)]);
    await poll(f);

    await eventually(() =>
      expect(telegram.texts()).toContain(
        "Assumi o card PROJ-1 (exemplo): Configurar integração com api_key: [segredo removido]",
      ),
    );
    expect(telegram.texts().join("\n")).not.toContain("123segredo");
  });

  it("no nível minimal manda só o evento e o card, sem título nem motivos", async () => {
    const { telegram, f } = await startWith(
      [card("PROJ-1", "A Fazer", secretTitle), { ...card("PROJ-2", "A Fazer"), description: undefined }],
      { config: { people: [], telegram: { content: "minimal" } } },
    );
    await poll(f);
    await waitForStatus(f, "PROJ-2", "bloqueada");

    await eventually(() =>
      expect(telegram.texts()).toEqual(
        expect.arrayContaining(["Assumi o card PROJ-1 (exemplo).", "A Tarefa PROJ-2 (exemplo) está bloqueada."]),
      ),
    );
    expect(telegram.texts().join("\n")).not.toMatch(/Configurar|PO/);
  });
});

describe("Telegram: falhas", () => {
  /** Avança o relógio falso aos poucos até `check` passar (as novas tentativas de envio usam o relógio da fábrica). */
  const advanceUntil = (clock: FakeClock, check: () => void) =>
    eventually(() => {
      clock.advanceTo(new Date(clock.now() + 5_000));
      check();
    });

  it("uma falha de envio não trava a fábrica, e a mensagem sai numa nova tentativa", async () => {
    const { telegram, clock, f } = await startWith([card("PROJ-1", "A Fazer")]);
    telegram.failNextSends(1);

    await poll(f);
    await waitForStatus(f, "PROJ-1", "concluida");

    await advanceUntil(clock, () =>
      expect(telegram.texts()).toEqual([
        "Assumi o card PROJ-1 (exemplo): Ajustar filtro PROJ-1",
        "A Tarefa PROJ-1 (exemplo) terminou.",
      ]),
    );
    expect((await events(f)).filter((e) => e.type === "delivery")).toEqual([]);
  });

  it("depois de 3 tentativas a mensagem é descartada com registro, e as seguintes continuam saindo", async () => {
    const { telegram, clock, f } = await startWith([card("PROJ-1", "A Fazer")]);
    telegram.failNextSends(3);

    await poll(f);
    await waitForStatus(f, "PROJ-1", "concluida");

    await advanceUntil(clock, () => expect(telegram.texts()).toEqual(["A Tarefa PROJ-1 (exemplo) terminou."]));
    expect((await events(f)).filter((e) => e.type === "delivery")).toEqual([
      expect.objectContaining({
        via: "telegram",
        status: "descartada",
        attempts: 3,
        text: "Assumi o card PROJ-1 (exemplo): Ajustar filtro PROJ-1",
        error: expect.stringMatching(/fora do ar/),
      }),
    ]);
  });

  it("um reinício não republica mensagens nem repete comandos já executados", async () => {
    const { telegram, f } = await startWith([card("PROJ-1", "A Fazer")]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "concluida");
    telegram.say("/pausar");
    await eventually(() => expect(telegram.texts()).toContain("Daemon pausado: nenhuma Tarefa nova começa."));
    await api(f, "POST", "/daemon/resume");
    const sent = telegram.texts();

    factory = await f.restart();
    await settle();

    expect(await api(factory, "GET", "/daemon")).toEqual({ paused: false });
    expect(telegram.texts()).toEqual(sent);
    telegram.say("/pausar");
    await eventually(async () => expect(await api(factory as TestFactory, "GET", "/daemon")).toEqual({ paused: true }));
  });
});
