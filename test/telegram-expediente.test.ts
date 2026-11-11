import { expect, it } from "vitest";
import type { ManagementProgress } from "../src/durable.js";
import type { FactoryEvent, NewEvent } from "../src/events.js";
import { startManagementBridge } from "../src/management.js";
import type { FactoryCommands } from "../src/packages/api-local/index.js";
import { FakeClock } from "./fakes/fake-clock.js";
import { FakeTelegram, TELEGRAM_CHAT } from "./fakes/fake-telegram.js";
import { eventually } from "./harness.js";

it("fila da empresa sobrevive ao reinício sem bloquear mensagens pessoais", async () => {
  const clock = new FakeClock("2026-11-07T10:00:00-03:00");
  const monday = Date.parse("2026-11-09T09:00:00-03:00");
  const telegram = new FakeTelegram();
  let progress: ManagementProgress | undefined;
  const log: FactoryEvent[] = [];
  const subscribers = new Set<(event: FactoryEvent) => void>();
  const append = async (event: NewEvent) => {
    const entry = { ...event, at: new Date(clock.now()).toISOString() } as FactoryEvent;
    log.push(entry);
    for (const subscriber of subscribers) subscriber(entry);
  };
  const start = () =>
    startManagementBridge({
      port: telegram,
      chat: TELEGRAM_CHAT,
      initialEventCount: 0,
      events: {
        list: () => log,
        append,
        subscribe: (fn) => {
          subscribers.add(fn);
          return () => subscribers.delete(fn);
        },
      },
      progress: {
        load: async () => progress,
        save: async (value) => {
          progress = structuredClone(value);
        },
      },
      tasks: async () => [],
      content: () => "full",
      availableAt: (project) => (project === "vetor" ? Math.max(monday, clock.now()) : clock.now()),
      now: clock.now,
      armTimer: (fn, ms) => clock.setTimer(fn, ms, { background: false }) ?? (() => {}),
      commands: {
        pause: async () => true,
        resume: async () => true,
        cancel: async () => true,
        veto: async () => "inexistente",
        reorder: async () => {},
        setDaemonPaused: async () => {},
        pausarProjeto: async () => {},
        retomarProjeto: async () => {},
      } as unknown as FactoryCommands,
    });
  let bridge = await start();
  try {
    await append({
      type: "question",
      project: "vetor",
      target: "SNPSM-1",
      n: 1,
      to: "po",
      text: "Pergunta corporativa",
      status: "enviada",
    });
    await append({
      type: "question",
      project: "sf",
      target: "SF-1",
      n: 1,
      to: "po",
      text: "Pergunta pessoal",
      status: "enviada",
    });
    await eventually(() => expect(telegram.texts().join("\n")).toContain("Pergunta pessoal"));
    expect(telegram.texts().join("\n")).not.toContain("Pergunta corporativa");
    await bridge.stop();
    bridge = await start();
    expect(telegram.texts().join("\n")).not.toContain("Pergunta corporativa");
    clock.advanceTo(new Date(monday));
    await eventually(() => expect(telegram.texts().join("\n")).toContain("Pergunta corporativa"));
    expect(telegram.texts().filter((text) => text.includes("Pergunta corporativa"))).toHaveLength(1);
  } finally {
    await bridge.stop();
  }
});

it.each(["atual", "legado"])("aviso diferido %s full não vaza segredo ao mudar para minimal", async (format) => {
  const clock = new FakeClock("2026-11-07T10:00:00-03:00");
  const monday = Date.parse("2026-11-09T09:00:00-03:00");
  const telegram = new FakeTelegram();
  let progress: ManagementProgress | undefined;
  let contentLevel: "full" | "minimal" = "full";
  const log: FactoryEvent[] = [];
  const subscribers = new Set<(event: FactoryEvent) => void>();
  const append = async (event: NewEvent) => {
    const entry = { ...event, at: new Date(clock.now()).toISOString() } as FactoryEvent;
    log.push(entry);
    for (const subscriber of subscribers) subscriber(entry);
  };
  const start = () =>
    startManagementBridge({
      port: telegram,
      chat: TELEGRAM_CHAT,
      initialEventCount: 0,
      events: {
        list: () => log,
        append,
        subscribe: (fn) => {
          subscribers.add(fn);
          return () => subscribers.delete(fn);
        },
      },
      progress: {
        load: async () => progress,
        save: async (value) => {
          progress = structuredClone(value);
        },
      },
      tasks: async () => [],
      content: () => contentLevel,
      availableAt: (project) => (project === "vetor" ? Math.max(monday, clock.now()) : clock.now()),
      now: clock.now,
      armTimer: (fn, ms) => clock.setTimer(fn, ms, { background: false }) ?? (() => {}),
      commands: {
        pause: async () => true,
        resume: async () => true,
        cancel: async () => true,
        veto: async () => "inexistente",
        reorder: async () => {},
        setDaemonPaused: async () => {},
        pausarProjeto: async () => {},
        retomarProjeto: async () => {},
      } as unknown as FactoryCommands,
    });
  let bridge = await start();
  try {
    await append({
      type: "question",
      project: "vetor",
      target: "SNPSM-1",
      n: 1,
      to: "po",
      text: "SEGREDONEGOCIO-contratos-confidenciais",
      status: "enviada",
    });
    await eventually(() => expect(progress?.deferred?.length).toBe(1));
    expect(telegram.texts().join("\n")).not.toContain("SEGREDONEGOCIO");
    await bridge.stop();
    if (format === "legado" && progress?.deferred) {
      // Contrato antigo da porta de progresso: guardava apenas projeto e mensagem renderizada.
      progress.deferred = progress.deferred.map(({ project, message }) => ({ project, message }));
    }
    contentLevel = "minimal";
    bridge = await start();
    clock.advanceTo(new Date(monday));
    await eventually(() => expect(telegram.texts().join("\n")).toMatch(/Pergunta 1 sobre SNPSM-1/));
    const delivered = telegram.texts().join("\n");
    expect(delivered).not.toContain("SEGREDONEGOCIO");
    expect(delivered).toContain("Consulte a interface web local");
  } finally {
    await bridge.stop();
  }
});
