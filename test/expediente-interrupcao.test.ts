import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type RunningFactory, startFactory } from "../src/factory.js";
import { FakeClock } from "./fakes/fake-clock.js";
import { DEFAULT_SPEC, deliverSpec, FakeModel } from "./fakes/fake-model.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";
import { MemoryRetroSink } from "./fakes/memory-retro-sink.js";
import {
  api,
  DEFAULT_DESCRIPTION,
  eventually,
  FACTORY_REPO,
  poll,
  statusOf,
  testProjectConfig,
  USER,
} from "./harness.js";

const CALENDAR = {
  timezone: "America/Sao_Paulo",
  workdays: ["mon", "tue", "wed", "thu", "fri"] as ("mon" | "tue" | "wed" | "thu" | "fri")[],
  start: "09:00",
  end: "18:00",
  holidays: [] as string[],
};

/** Segunda 17:59 no fuso do expediente aprovado. */
const BEFORE_CLOSE = "2026-11-09T17:59:00-03:00";
/** Segunda 18:00: fim exclusivo do expediente. */
const AT_CLOSE = "2026-11-09T18:00:00-03:00";
/** Terça 09:00: retomada. */
const NEXT_OPEN = "2026-11-10T09:00:00-03:00";

describe("interrupção estrita no fechamento do expediente", () => {
  let factory: RunningFactory | undefined;
  let stateDir: string | undefined;
  let empresaSource: MemoryDemandSource;
  let pessoalSource: MemoryDemandSource;
  let model: FakeModel;
  let clock: FakeClock;

  afterEach(async () => {
    await factory?.close();
    factory = undefined;
    if (stateDir) await rm(stateDir, { recursive: true, force: true });
    stateDir = undefined;
  });

  async function start() {
    clock = new FakeClock(BEFORE_CLOSE);
    model = new FakeModel();
    // Modelo lento abortável só na empresa: fora do expediente não entrega; o signal do harness o aborta.
    model.respond = async (call) => {
      if (!call.tools.includes("entregar_spec")) return deliverSpec(DEFAULT_SPEC);
      if (call.input.includes("EMP-1") && clock.now() < Date.parse(NEXT_OPEN)) return new Promise(() => {});
      return deliverSpec(DEFAULT_SPEC);
    };
    empresaSource = new MemoryDemandSource([
      {
        key: "EMP-1",
        title: "Card da empresa",
        status: "A Fazer",
        assignee: USER,
        description: DEFAULT_DESCRIPTION,
      },
    ]);
    pessoalSource = new MemoryDemandSource([
      {
        key: "PES-1",
        title: "Card pessoal",
        status: "A Fazer",
        assignee: USER,
        description: DEFAULT_DESCRIPTION,
      },
    ]);
    stateDir = await mkdtemp(join(tmpdir(), "fabrica-expediente-"));
    factory = await startFactory({
      statePath: join(stateDir, "fabrica.sqlite"),
      retryDelayMs: 5,
      models: model.models(),
      clock,
      retro: { sink: new MemoryRetroSink(), repo: FACTORY_REPO },
      projects: [
        {
          config: testProjectConfig({
            name: "empresa",
            activity: "business-hours",
            calendar: { ...CALENDAR },
            source: { type: "jira", project: "EMP", assignee: USER },
          }),
          source: empresaSource,
        },
        {
          config: testProjectConfig({
            name: "pessoal",
            activity: "always",
            source: { type: "jira", project: "PES", assignee: USER },
          }),
          source: pessoalSource,
        },
      ],
    });
    return factory;
  }

  function reopen(): Promise<RunningFactory> {
    if (!stateDir) throw new Error("estado da fábrica ainda não foi criado");
    return startFactory({
      statePath: join(stateDir, "fabrica.sqlite"),
      retryDelayMs: 5,
      models: model.models(),
      clock,
      retro: { sink: new MemoryRetroSink(), repo: FACTORY_REPO },
      projects: [
        {
          config: testProjectConfig({
            name: "empresa",
            activity: "business-hours",
            calendar: { ...CALENDAR },
            source: { type: "jira", project: "EMP", assignee: USER },
          }),
          source: empresaSource,
        },
        {
          config: testProjectConfig({
            name: "pessoal",
            activity: "always",
            source: { type: "jira", project: "PES", assignee: USER },
          }),
          source: pessoalSource,
        },
      ],
    });
  }

  it("às 18h interrompe a SPEC ativa, libera a fila ao always e retoma no próximo útil", async () => {
    const f = await start();
    await poll(f);

    await eventually(async () => {
      expect(await statusOf(f, "EMP-1")).toBe("ativa");
      expect(model.calls.some((c) => c.tools.includes("entregar_spec"))).toBe(true);
    });
    expect(await statusOf(f, "PES-1")).toBe("enfileirada");
    expect(clock.now()).toBe(Date.parse(BEFORE_CLOSE));

    clock.advanceTo(AT_CLOSE);

    await eventually(async () => {
      expect(await statusOf(f, "EMP-1")).toBe("enfileirada");
    });
    const empresa = (await api<{ key: string; status: string; reason?: string | null }[]>(f, "GET", "/tasks")).find(
      (t) => t.key === "EMP-1",
    );
    expect(empresa).toMatchObject({ status: "enfileirada" });
    expect(empresa?.reason ?? null).toBeNull();

    await poll(f);
    await eventually(async () => {
      expect(await statusOf(f, "PES-1")).toBe("concluida");
    });
    expect(await statusOf(f, "EMP-1")).toBe("enfileirada");

    clock.advanceTo(NEXT_OPEN);
    await eventually(async () => {
      expect(await statusOf(f, "EMP-1")).toBe("concluida");
    }, 5000);
    expect(empresaSource.commentsOf("EMP-1").some((c) => c.body.includes("SPEC"))).toBe(true);
  });

  it("retoma após reinício do daemon no próximo útil", async () => {
    const f = await start();
    await poll(f);
    await eventually(async () => {
      expect(await statusOf(f, "EMP-1")).toBe("ativa");
      expect(model.calls.some((c) => c.tools.includes("entregar_spec"))).toBe(true);
    });
    clock.advanceTo(AT_CLOSE);
    await eventually(async () => {
      expect(await statusOf(f, "EMP-1")).toBe("enfileirada");
    });
    await f.close();

    const restarted = await reopen();
    factory = restarted;
    expect(await statusOf(restarted, "EMP-1")).toBe("enfileirada");
    clock.advanceTo(NEXT_OPEN);
    await eventually(async () => {
      expect(await statusOf(restarted, "EMP-1")).toBe("concluida");
    }, 8000);
  });
});
