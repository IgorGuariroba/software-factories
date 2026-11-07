import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "./fakes/fake-clock.js";
import { askPo, DEFAULT_SPEC, deliverSpec, FakeModel, type ModelCall } from "./fakes/fake-model.js";
import { FakeTelegram } from "./fakes/fake-telegram.js";
import {
  api,
  DEFAULT_DESCRIPTION,
  events,
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

const card = (key: string) => ({
  key,
  title: `Card ${key}`,
  status: "A Fazer",
  assignee: USER,
});

describe("projeto removido da config", () => {
  it("poll confere respostas dos demais e registra erro da Tarefa histórica sem projeto", async () => {
    const clock = new FakeClock("2026-11-09T12:00:00Z");
    const model = new FakeModel();
    model.respond = (call: ModelCall) =>
      call.input.includes("# Card OLD-1") && !call.input.includes("Resposta do PO")
        ? askPo("Qual o prazo?")
        : deliverSpec(DEFAULT_SPEC);
    factory = await startTestFactory({
      cards: [card("OLD-1")],
      model,
      clock,
      telegram: new FakeTelegram(),
      config: { name: "antigo" },
    });
    await poll(factory);
    await waitForStatus(factory, "OLD-1", "aguardando-humano");

    factory.source.cards.splice(0, factory.source.cards.length, { ...card("NEW-1"), description: DEFAULT_DESCRIPTION });
    factory = await factory.restart({ config: { name: "novo" } });

    const res = await fetch(`${factory.url}/poll`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(await statusOf(factory, "OLD-1")).toBe("aguardando-humano");
    await waitForStatus(factory, "NEW-1", "concluida");
    expect(
      (await events(factory)).some((e) => e.type === "error" && e.project === "antigo" && e.target === "OLD-1"),
    ).toBe(true);
  });

  it("agendamento ignora Tarefa enfileirada de projeto removido e segue com as demais", async () => {
    const clock = new FakeClock("2026-11-09T12:00:00Z");
    const model = new FakeModel();
    factory = await startTestFactory({
      cards: [card("OLD-1")],
      model,
      clock,
      telegram: new FakeTelegram(),
      config: { name: "antigo" },
    });
    await api(factory, "POST", "/daemon/pause");
    await poll(factory);
    expect(await statusOf(factory, "OLD-1")).toBe("enfileirada");

    factory.source.cards.splice(0, factory.source.cards.length, { ...card("NEW-1"), description: DEFAULT_DESCRIPTION });
    factory = await factory.restart({ config: { name: "novo" } });
    await api(factory, "POST", "/daemon/resume");
    await poll(factory);

    expect(await statusOf(factory, "OLD-1")).toBe("enfileirada");
    await waitForStatus(factory, "NEW-1", "concluida");
    expect(
      (await events(factory)).some((e) => e.type === "error" && e.project === "antigo" && e.target === "OLD-1"),
    ).toBe(true);
  });
});
