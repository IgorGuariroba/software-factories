import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import type { Card } from "../src/demand-source.js";
import { type RunningFactory, startFactory } from "../src/factory.js";
import type { TestRunner } from "../src/test-runner.js";
import type { FakeClock } from "./fakes/fake-clock.js";
import { FakeCodeHost } from "./fakes/fake-code-host.js";
import { FakeModel } from "./fakes/fake-model.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";

export const USER = "igor";
/** O PO declarado nas pessoas do projeto de teste. */
export const PO = "po-ficticio";
/** Descrição que os cards dos testes recebem quando o teste não diz outra: o bastante para a SPEC não exigir o PO. */
export const DEFAULT_DESCRIPTION =
  "Descrição de teste com detalhe suficiente: o objetivo, as regras de negócio e os critérios de aceite estão aqui.";

export function testProjectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "exemplo",
    dryRun: false,
    source: { type: "jira", project: "PROJ", assignee: USER },
    roles: { spec: { provider: FakeModel.PROVIDER, model: "spec-a" } },
    people: [{ id: PO, role: "po" }],
    vetoMinutes: 30,
    calendar: {
      timezone: "UTC",
      workdays: ["mon", "tue", "wed", "thu", "fri"],
      start: "09:00",
      end: "18:00",
      holidays: [],
    },
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
  model: FakeModel;
  codeHost: FakeCodeHost;
  /** Diretório do estado durável (e dos clones da fábrica, em `worktrees/`). */
  stateDir: string;
  /** Fecha a fábrica e sobe outra sobre o mesmo estado durável e a mesma Fonte: um reinício do daemon. */
  restart(): Promise<TestFactory>;
}

interface TestFactoryOptions {
  cards?: Card[];
  source?: MemoryDemandSource;
  dryRun?: boolean;
  pollIntervalMs?: number;
  model?: FakeModel;
  codeHost?: FakeCodeHost;
  testRunner?: TestRunner;
  /** Conteúdo de `knowledge.md` do projeto. */
  knowledge?: string;
  config?: Partial<ProjectConfig>;
  /** Relógio falso da fábrica; sem ele, o relógio do sistema. O mesmo relógio continua depois de `restart()`. */
  clock?: FakeClock;
}

/** A fábrica inteira, com todas as portas trocadas por fakes em memória e estado durável num diretório temporário. */
export async function startTestFactory(opts: TestFactoryOptions = {}, stateDir?: string): Promise<TestFactory> {
  const dir = stateDir ?? (await mkdtemp(join(tmpdir(), "fabrica-estado-")));
  // Um card sem `description` no teste recebe a padrão; `description: undefined` explícito o deixa vazio.
  const source =
    opts.source ?? new MemoryDemandSource(opts.cards?.map((c) => ({ description: DEFAULT_DESCRIPTION, ...c })));
  const model = opts.model ?? new FakeModel();
  const codeHost = opts.codeHost ?? new FakeCodeHost();
  const knowledgeDir = join(dir, "conhecimento");
  await mkdir(knowledgeDir, { recursive: true });
  if (opts.knowledge !== undefined) await writeFile(join(knowledgeDir, "knowledge.md"), opts.knowledge);
  const factory = await startFactory({
    pollIntervalMs: opts.pollIntervalMs,
    statePath: join(dir, "fabrica.sqlite"),
    retryDelayMs: 5,
    models: model.models(),
    testRunner: opts.testRunner,
    clock: opts.clock,
    projects: [
      { config: testProjectConfig({ dryRun: opts.dryRun ?? false, ...opts.config }), source, knowledgeDir, codeHost },
    ],
  });
  return {
    ...factory,
    source,
    model,
    codeHost,
    stateDir: dir,
    close: async () => {
      await factory.close();
      await rm(dir, { recursive: true, force: true });
    },
    restart: async () => {
      await factory.close();
      return startTestFactory({ ...opts, source, model, codeHost, knowledge: undefined }, dir);
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

export const waitForStatus = (f: RunningFactory, key: string, status: string, timeoutMs?: number) =>
  eventually(async () => expect(await statusOf(f, key)).toBe(status), timeoutMs);

/** Uma promessa que o teste resolve quando quiser: segura uma operação da Fonte "no meio". */
export function hold(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Só os comentários de assunção do card (o card também recebe SPEC e Tickets). */
export const assumeComments = (source: MemoryDemandSource, key: string) =>
  source.commentsOf(key).filter((c) => c.body.endsWith("Assumindo este card."));
