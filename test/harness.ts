import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import type { Card } from "../src/demand-source.js";
import { type RunningFactory, startFactory } from "../src/factory.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";

export const USER = "igor";

export function testProjectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "exemplo",
    dryRun: false,
    source: { type: "jira", project: "PROJ", assignee: USER },
    statuses: {
      Backlog: "backlog",
      "A Fazer": "todo",
      "Em Andamento": "in_progress",
      "Aguardando Teste": "waiting_test",
      "Aguardando Validação": "waiting_validation",
      GMUD: "gmud",
      Concluído: "done",
    },
    ...overrides,
  };
}

export interface TestFactory extends RunningFactory {
  source: MemoryDemandSource;
  /** Fecha a fábrica e sobe outra sobre o mesmo estado durável e a mesma Fonte: um reinício do daemon. */
  restart(): Promise<TestFactory>;
}

interface TestFactoryOptions {
  cards?: Card[];
  source?: MemoryDemandSource;
  dryRun?: boolean;
  pollIntervalMs?: number;
}

/** A fábrica inteira, com todas as portas trocadas por fakes em memória e estado durável num diretório temporário. */
export async function startTestFactory(opts: TestFactoryOptions = {}, stateDir?: string): Promise<TestFactory> {
  const dir = stateDir ?? (await mkdtemp(join(tmpdir(), "fabrica-estado-")));
  const source = opts.source ?? new MemoryDemandSource(opts.cards);
  const factory = await startFactory({
    pollIntervalMs: opts.pollIntervalMs,
    statePath: join(dir, "fabrica.sqlite"),
    retryDelayMs: 5,
    projects: [{ config: testProjectConfig({ dryRun: opts.dryRun ?? false }), source }],
  });
  return {
    ...factory,
    source,
    close: async () => {
      await factory.close();
      await rm(dir, { recursive: true, force: true });
    },
    restart: async () => {
      await factory.close();
      return startTestFactory({ ...opts, source }, dir);
    },
  };
}

// --- Ações e leituras pela API -------------------------------------------------------------

export async function api<T = unknown>(f: RunningFactory, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${f.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.status, `${method} ${path}`).toBeLessThan(300);
  return (await res.json()) as T;
}

export const poll = (f: RunningFactory) => api(f, "POST", "/poll");

export interface TaskView {
  id: string;
  project: string;
  key: string;
  status: string;
}
export const tasks = (f: RunningFactory) => api<TaskView[]>(f, "GET", "/tasks");
export const events = (f: RunningFactory) => api<Record<string, unknown>[]>(f, "GET", "/events");

/** Espera até `check` passar (sem lançar), consultando de novo a cada poucos ms. */
export async function eventually(check: () => Promise<void> | void, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

export async function statusOf(f: RunningFactory, key: string): Promise<string | undefined> {
  return (await tasks(f)).find((t) => t.key === key)?.status;
}

export const waitForStatus = (f: RunningFactory, key: string, status: string) =>
  eventually(async () => expect(await statusOf(f, key)).toBe(status));

/** Uma promessa que o teste resolve quando quiser: segura uma operação da Fonte "no meio". */
export function hold(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
