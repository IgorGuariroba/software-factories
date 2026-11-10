import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import type { Card } from "../src/demand-source.js";
import { type RunningFactory, startFactory } from "../src/factory.js";
import type { TeamsNotifier } from "../src/teams-mcp.js";
import type { TestRunner } from "../src/test-runner.js";
import type { FakeClock } from "./fakes/fake-clock.js";
import { FakeCodeHost } from "./fakes/fake-code-host.js";
import { FakeModel } from "./fakes/fake-model.js";
import { type FakeTelegram, TELEGRAM_CHAT, TELEGRAM_USER } from "./fakes/fake-telegram.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";
import { MemoryRetroSink } from "./fakes/memory-retro-sink.js";

export const USER = "igor";
/** Repositório (público) da fábrica onde as retrôs dos testes abrem issues. */
export const FACTORY_REPO = "fabrica/fabrica-publica";
/** O PO declarado nas pessoas do projeto de teste. */
export const PO = "po-ficticio";
/** Descrição que os cards dos testes recebem quando o teste não diz outra: o bastante para a SPEC não exigir o PO. */
export const DEFAULT_DESCRIPTION =
  "Descrição de teste com detalhe suficiente: o objetivo, as regras de negócio e os critérios de aceite estão aqui.";

export function testProjectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "exemplo",
    dryRun: false,
    activity: "always",
    questionApproval: false,
    specApproval: false,
    retroApproval: false,
    announceAssume: true,
    source: { type: "jira", project: "PROJ", assignee: USER },
    people: [{ id: PO, role: "po" }],
    profiles: [],
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
    roles: {
      spec: { provider: FakeModel.PROVIDER, model: "spec-a", family: "implementer-fake" },
      reviewer: { provider: FakeModel.PROVIDER, model: "spec-b", family: "reviewer-fake" },
      ...overrides.roles,
    },
  };
}

export interface TestFactory extends RunningFactory {
  source: MemoryDemandSource;
  model: FakeModel;
  codeHost: FakeCodeHost;
  /** Issues da fábrica (GitHub fake) onde as retrôs publicam. */
  retroSink: MemoryRetroSink;
  /** Diretório do estado durável (e dos clones da fábrica, em `worktrees/`). */
  stateDir: string;
  /** Fecha a fábrica e sobe outra sobre o mesmo estado durável e a mesma Fonte: um reinício do daemon. */
  /** `overrides` muda as opções do novo daemon (ex.: a config do projeto), mantendo estado, Fonte e modelo. */
  restart(overrides?: Partial<TestFactoryOptions>): Promise<TestFactory>;
  /**
   * Reinício com o YAML alterado sobre o mesmo estado, sem gravar a configuração pela API: é o caso em que a semente
   * não deve ter efeito (ADR-0017).
   */
  restartComYaml(config: Partial<ProjectConfig>): Promise<TestFactory>;
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
  /** Telegram fake como interface de gestão, com o chat e o usuário autorizados de `fake-telegram.ts`. */
  telegram?: FakeTelegram;
  teams?: TeamsNotifier;
  /** Conversa 1:1 das pessoas no Teams (canal `teams`): fake em memória com as respostas que a pessoa der. */
  teamsConversation?: import("../src/teams-conversa.js").TeamsConversation;
  retroSink?: MemoryRetroSink;
  /** Repositório da fábrica para as issues de retrô; `null` desliga (como sem `FACTORY_RETRO_REPO`). */
  retroRepo?: string | null;
  /** Secret do GitHub App: liga o receptor do webhook numa porta livre (`webhookUrl`). */
  webhookSecret?: string;
  /** Painel do GitHub App: App ID e chave (caminho) e o `fetch` falso que responde pela API do GitHub. */
  githubApp?: { appId?: number; privateKeyPath?: string; fetch?: typeof fetch };
  /** Clone do repositório de um projeto criado pela UI, falso nos testes (sem rede). */
  clonarRepositorio?: (opts: { repo: string; instalacaoId: number; destino: string }) => Promise<void>;
  /** Clone e conferência de um repositório GitLab de projeto criado pela UI, falsos nos testes (sem rede). */
  clonarRepositorioGitlab?: (opts: { host: string; caminho: string; token: string; destino: string }) => Promise<void>;
  fetchGitlab?: typeof fetch;
  /** Janela de agrupamento dos avisos. Padrão nos testes: 0 (cada aviso sai na hora). */
  avisoJanelaMs?: number;
  /** Fonte dos projetos criados pela interface. Padrão: uma Fonte em memória vazia (sem cards). */
  createSource?: (config: ProjectConfig) => import("../src/demand-source.js").DemandSource;
  /** `fetch` falso para a checagem de conexão com a Fonte (ex.: Jira) antes de salvar a configuração. */
  fetchFonte?: typeof fetch;
  /** Fábrica da interface de gestão salva pela API (Telegram), usada quando não há interface pelo ambiente. */
  criarInterfaceTelegram?: (token: string, chat: string) => import("../src/management.js").ManagementInterface;
}

/** A fábrica inteira, com todas as portas trocadas por fakes em memória e estado durável num diretório temporário. */
export async function startTestFactory(opts: TestFactoryOptions = {}, stateDir?: string): Promise<TestFactory> {
  const dir = stateDir ?? (await mkdtemp(join(tmpdir(), "fabrica-estado-")));
  // Um card sem `description` no teste recebe a padrão; `description: undefined` explícito o deixa vazio.
  const source =
    opts.source ?? new MemoryDemandSource(opts.cards?.map((c) => ({ description: DEFAULT_DESCRIPTION, ...c })));
  const model = opts.model ?? new FakeModel();
  const codeHost = opts.codeHost ?? new FakeCodeHost();
  const retroSink = opts.retroSink ?? new MemoryRetroSink();
  const retroRepo = opts.retroRepo === undefined ? FACTORY_REPO : opts.retroRepo;
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
    management: opts.telegram && { port: opts.telegram, chat: TELEGRAM_CHAT, user: TELEGRAM_USER },
    teams: opts.teams,
    teamsConversation: opts.teamsConversation,
    retro: { sink: retroSink, repo: retroRepo ?? undefined },
    webhook: opts.webhookSecret ? { port: 0, secret: opts.webhookSecret } : undefined,
    avisos: { janelaMs: opts.avisoJanelaMs ?? 0 },
    githubApp: opts.githubApp,
    clonarRepositorio: opts.clonarRepositorio,
    clonarRepositorioGitlab: opts.clonarRepositorioGitlab,
    fetchGitlab: opts.fetchGitlab,
    fetchFonte: opts.fetchFonte,
    criarInterfaceTelegram: opts.criarInterfaceTelegram,
    createSource: opts.createSource ?? (() => new MemoryDemandSource([])),
    projects: [
      { config: testProjectConfig({ dryRun: opts.dryRun ?? false, ...opts.config }), source, knowledgeDir, codeHost },
    ],
  });
  return {
    ...factory,
    source,
    model,
    codeHost,
    retroSink,
    stateDir: dir,
    close: async () => {
      await factory.close();
      await rm(dir, { recursive: true, force: true });
    },
    restart: async (overrides = {}) => {
      const proxima = { ...opts, source, model, codeHost, retroSink, knowledge: undefined, ...overrides };
      // ADR-0017: depois da semente, a configuração que vale é a guardada. Uma configuração nova entra pela API antes do
      // reinício, como faria a interface.
      if (overrides.config !== undefined || overrides.dryRun !== undefined) {
        const config = testProjectConfig({ dryRun: proxima.dryRun ?? false, ...proxima.config });
        // Um projeto novo entra pela semente no startup; só um já guardado é alterado pela API.
        const guardado = await fetch(`${factory.url}/projetos/${config.name}/configuracao`);
        if (guardado.ok) await api(factory, "PUT", `/projetos/${config.name}/configuracao`, config);
      }
      await factory.close();
      return startTestFactory(proxima, dir);
    },
    restartComYaml: async (config) => {
      await factory.close();
      return startTestFactory({ ...opts, source, model, codeHost, retroSink, knowledge: undefined, config }, dir);
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
  stage?: string | null;
  reason?: string | null;
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
  source.commentsOf(key).filter((c) => c.body.startsWith("Assumindo este card."));
