import { mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  createRegistry,
  defineExtension,
  Harness,
  ROOT_CONVERSATION_ID,
  type TaskId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { API_SCHEMA } from "./api-schema.js";
import type { CardState, ProjectConfig } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import {
  createTarefaTask,
  EventEntry,
  eventToJson,
  type FactoryState,
  GateTask,
  type QueuedTask,
  StateDoc,
} from "./durable.js";
import { createEffectWriter, type EffectWriter, GuardrailViolation } from "./effect-writer.js";
import type { EventRecorder, FactoryEvent, NewEvent } from "./events.js";

export interface FactoryProject {
  config: ProjectConfig;
  source: DemandSource;
}

export interface QueueItem {
  project: string;
  key: string;
  title: string;
  status: string;
  state: CardState;
}

export interface RunningFactory {
  url: string;
  close(): Promise<void>;
}

/** Estados em que a fábrica assume um card. */
const ELIGIBLE: ReadonlySet<CardState> = new Set(["todo", "in_progress"]);

/** Estado mais avançado para onde a fábrica move cards no M1. */
const TRANSITION_LIMIT: CardState = "in_progress";

/** Log de eventos durável: cada evento é uma entry na conversa raiz, e os assinantes recebem os novos. */
class DurableEventLog implements EventRecorder {
  private events: FactoryEvent[] = [];
  private subscribers = new Set<(event: FactoryEvent) => void>();

  constructor(private harness: Harness) {}

  async load(): Promise<void> {
    const root = await this.harness.root(context);
    let cursor: Parameters<typeof root.entries>[2];
    do {
      const page = await root.entries({ order: "ascending" }, 500, cursor, context);
      for (const entry of page.items) {
        if (EventEntry.is(entry) && entry.data) this.events.push(entry.data as unknown as FactoryEvent);
      }
      cursor = page.next;
    } while (cursor);
  }

  async append(event: NewEvent): Promise<void> {
    const full = { ...event, at: new Date().toISOString() } as FactoryEvent;
    await this.harness.commit(
      (tx) => tx.appendEntry(EventEntry, ROOT_CONVERSATION_ID, { data: eventToJson(full) }),
      context,
    );
    this.events.push(full);
    for (const subscriber of this.subscribers) subscriber(full);
  }

  list(): FactoryEvent[] {
    return [...this.events];
  }

  subscribe(subscriber: (event: FactoryEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
}

/** Sobe a fábrica: estado durável, agendador da fila única e API local, sempre só em localhost. */
export async function startFactory(opts: {
  projects: FactoryProject[];
  /** Arquivo SQLite do estado durável. */
  statePath: string;
  port?: number;
  /** Intervalo entre buscas automáticas na Fonte. Sem ele, a fábrica só busca via `POST /poll`. */
  pollIntervalMs?: number;
  /** Espera antes de tentar de novo uma Tarefa que falhou. Padrão: 1 minuto. */
  retryDelayMs?: number;
}): Promise<RunningFactory> {
  const retryDelayMs = opts.retryDelayMs ?? 60_000;
  let events!: DurableEventLog;
  const projects = new Map(
    opts.projects.map((p) => [
      p.config.name,
      {
        ...p,
        writer: createEffectWriter({
          ...p,
          events: { append: (e) => events.append(e), list: () => events.list() },
          transitionLimit: TRANSITION_LIMIT,
        }) satisfies EffectWriter,
      },
    ]),
  );
  const projectOf = (name: string) => {
    const project = projects.get(name);
    if (!project) throw new Error(`Projeto ${name} não está configurado`);
    return project;
  };

  const Tarefa = createTarefaTask({
    retryDelayMs,
    async run(input, step) {
      const { writer } = projectOf(input.project);
      if (step === "comentar") await writer.commentOnce(input.key, "Assumindo este card.");
      else await writer.transition(input.key, "in_progress", { from: "todo" });
    },
    classify: (err) =>
      err instanceof GuardrailViolation
        ? { kind: "blocked", reason: err.message }
        : { kind: "error", message: err instanceof Error ? err.message : String(err) },
    onError: (input, message) => events.append({ type: "error", project: input.project, target: input.key, message }),
  });

  const registry = createRegistry();
  registry.install(defineExtension({ name: "fabrica", tasks: [Tarefa, GateTask] }));
  await mkdir(dirname(opts.statePath), { recursive: true });
  const harness = await Harness.open(
    await openNodeSqliteStorage(opts.statePath),
    {
      models: createModels(),
      registry,
      onReport: (report) => console.error(`[fábrica] ${report.kind}:`, report.error),
    },
    context,
  );
  await harness.root(context);
  events = new DurableEventLog(harness);
  await events.load();

  const readState = async (): Promise<FactoryState> =>
    (await harness.snapshot(StateDoc, context)) ?? { daemonPaused: false, tasks: [] };

  // --- Fila ------------------------------------------------------------------------------------

  /** Cards elegíveis na Fonte agora. */
  async function queue(): Promise<QueueItem[]> {
    const items: QueueItem[] = [];
    for (const { config, source } of projects.values()) {
      for (const card of await source.listAssignedCards(config.source.assignee)) {
        const state = config.statuses[card.status];
        if (card.assignee !== config.source.assignee || !state || !ELIGIBLE.has(state)) continue;
        items.push({ project: config.name, key: card.key, title: card.title, status: card.status, state });
      }
    }
    return items;
  }

  /** Busca na Fonte e enfileira os cards "A Fazer" que ainda não viraram Tarefa. */
  async function poll(): Promise<void> {
    const todo = (await queue()).filter((item) => item.state === "todo");
    await harness.commit(async (tx) => {
      const state = await tx.doc(StateDoc);
      for (const item of todo) {
        const id = `${item.project}/${item.key}`;
        if (state.tasks.some((t) => t.id === id)) continue;
        state.tasks.push({
          id,
          project: item.project,
          key: item.key,
          title: item.title,
          status: "enfileirada",
          durableId: null,
          gateId: null,
          pauseRequested: false,
          notBefore: null,
          attempts: 0,
          reason: null,
        });
      }
    }, context);
  }

  // --- Agendador -------------------------------------------------------------------------------

  let closing = false;
  let retryTimer: NodeJS.Timeout | undefined;
  let known = new Map((await readState()).tasks.map((t) => [t.id, t.status]));

  /** Ativa a próxima Tarefa se nenhuma estiver ativa. Abre o portão de uma Tarefa que estava pausada. */
  async function schedule(): Promise<void> {
    const state = await readState();
    if (state.daemonPaused || state.tasks.some((t) => t.status === "ativa")) return;
    const now = Date.now();
    const next = state.tasks.find((t) => t.status === "enfileirada" && !t.pauseRequested && (t.notBefore ?? 0) <= now);
    if (!next) {
      const wakeAt = Math.min(
        ...state.tasks.filter((t) => t.status === "enfileirada" && t.notBefore).map((t) => t.notBefore as number),
      );
      if (Number.isFinite(wakeAt) && !closing) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(react, Math.max(0, wakeAt - now));
      }
      return;
    }
    let gateToOpen: number | null = null;
    await harness.commit(async (tx) => {
      const draft = await tx.doc(StateDoc);
      const task = draft.tasks.find((t) => t.id === next.id);
      if (task?.status !== "enfileirada" || draft.tasks.some((t) => t.status === "ativa")) return;
      task.status = "ativa";
      task.notBefore = null;
      if (task.gateId !== null) {
        gateToOpen = task.gateId;
        task.gateId = null;
      } else {
        task.durableId = await tx.createTask(
          Tarefa,
          { id: task.id, project: task.project, key: task.key },
          { ownership: { kind: "conversation" }, conversationId: ROOT_CONVERSATION_ID },
        );
      }
    }, context);
    if (gateToOpen !== null) await harness.abortTask(gateToOpen as TaskId, context);
  }

  /** Emite um evento para cada Tarefa que mudou de status desde a última vez. */
  async function emitStatusChanges(): Promise<void> {
    const state = await readState();
    const changed = state.tasks.filter((t) => known.get(t.id) !== t.status);
    known = new Map(state.tasks.map((t) => [t.id, t.status]));
    for (const t of changed) {
      await events.append({
        type: "task",
        project: t.project,
        id: t.id,
        key: t.key,
        status: t.status,
        ...(t.reason && (t.status === "bloqueada" || t.status === "enfileirada") ? { reason: t.reason } : {}),
      });
    }
  }

  // Reage a cada commit: uma reação por vez, e no máximo uma pendente.
  let reacting: Promise<void> = Promise.resolve();
  let reactPending = false;
  function react(): void {
    if (reactPending || closing) return;
    reactPending = true;
    reacting = reacting.then(async () => {
      reactPending = false;
      if (closing) return;
      try {
        await emitStatusChanges();
        await schedule();
      } catch (err) {
        if (!closing) console.error("[fábrica] erro no agendador:", err);
      }
    });
  }
  const observation = harness.observeCommits({ advance: () => queueMicrotask(react), end: () => undefined });
  harness.resume();
  react();

  // --- Comandos ----------------------------------------------------------------------------------

  /** Altera uma Tarefa no estado durável. Retorna `false` se ela não existe. */
  async function updateTask(id: string, change: (task: QueuedTask, state: FactoryState) => void): Promise<boolean> {
    return harness.commit(async (tx) => {
      const state = await tx.doc(StateDoc);
      const task = state.tasks.find((t) => t.id === id);
      if (!task) return false;
      change(task, state);
      return true;
    }, context);
  }

  const TERMINAL = new Set(["concluida", "cancelada", "bloqueada"]);
  const commands = {
    pause: (id: string) =>
      updateTask(id, (task) => {
        if (TERMINAL.has(task.status)) return;
        task.pauseRequested = true;
        if (task.status === "enfileirada") task.status = "pausada";
      }),
    resume: (id: string) =>
      updateTask(id, (task) => {
        task.pauseRequested = false;
        if (task.status === "pausada") task.status = "enfileirada";
      }),
    async cancel(id: string) {
      let durableId: number | null = null;
      const found = await updateTask(id, (task) => {
        if (TERMINAL.has(task.status)) return;
        if (task.durableId !== null) durableId = task.durableId;
        else task.status = "cancelada";
      });
      if (durableId !== null) await harness.abortTask(durableId as TaskId, context);
      return found;
    },
    setDaemonPaused: (paused: boolean) =>
      harness.commit(async (tx) => {
        const state = await tx.doc(StateDoc);
        state.daemonPaused = paused;
        // Ao retomar, as Tarefas paradas só pela pausa do daemon voltam para a fila.
        if (!paused)
          for (const t of state.tasks) if (t.status === "pausada" && !t.pauseRequested) t.status = "enfileirada";
      }, context),
    reorder: (ids: string[]) =>
      harness.commit(async (tx) => {
        const state = await tx.doc(StateDoc);
        const first = [...new Set(ids)]
          .map((id) => state.tasks.find((t) => t.id === id))
          .filter((t) => t !== undefined);
        state.tasks = [...first, ...state.tasks.filter((t) => !first.includes(t))];
      }, context),
  };

  // --- API HTTP ----------------------------------------------------------------------------------

  const json = (res: ServerResponse, status: number, body: unknown) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(payload);
  };
  const readBody = async (req: IncomingMessage): Promise<unknown> => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : undefined;
  };
  const streams = new Set<ServerResponse>();

  /**
   * Só clientes locais: Host precisa ser localhost/127.0.0.1 na porta do servidor (barra DNS rebinding) e um POST com
   * Origin precisa vir dessas mesmas origens (barra CSRF de páginas abertas no navegador).
   */
  const localHosts = () => {
    const { port } = server.address() as AddressInfo;
    return new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  };
  const isLocalRequest = (req: IncomingMessage): boolean => {
    const hosts = localHosts();
    if (!hosts.has((req.headers.host ?? "").toLowerCase())) return false;
    const origin = req.headers.origin;
    if (req.method !== "POST" || origin === undefined) return true;
    return [...hosts].some((h) => origin.toLowerCase() === `http://${h}`);
  };
  const isJson = (req: IncomingMessage) =>
    (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() === "application/json";

  const server = createServer(async (req, res) => {
    try {
      if (!isLocalRequest(req)) return json(res, 403, { error: "a API aceita só clientes locais" });
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = `${req.method} ${url.pathname}`;
      const taskCommand = url.pathname.match(/^\/tasks\/([^/]+)\/([^/]+)\/(pause|resume|cancel)$/);

      if (route === "GET /queue") return json(res, 200, await queue());
      if (route === "GET /tasks") {
        const { tasks } = await readState();
        return json(
          res,
          200,
          tasks.map(({ id, project, key, title, status, attempts, reason }) => ({
            id,
            project,
            key,
            title,
            status,
            attempts,
            reason,
          })),
        );
      }
      if (route === "POST /poll") {
        await serializedPoll();
        return json(res, 200, { ok: true });
      }
      if (route === "POST /tasks/order") {
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const body = (await readBody(req)) as { ids?: unknown };
        if (!Array.isArray(body?.ids)) return json(res, 400, { error: "envie { ids: string[] }" });
        await commands.reorder(body.ids.map(String));
        return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && taskCommand) {
        const [, project, key, command] = taskCommand as unknown as [string, string, string, keyof typeof commands];
        const id = `${decodeURIComponent(project)}/${decodeURIComponent(key)}`;
        const found = await (commands[command] as (id: string) => Promise<boolean>)(id);
        return found ? json(res, 200, { ok: true }) : json(res, 404, { error: `Tarefa ${id} não existe` });
      }
      if (route === "GET /daemon") return json(res, 200, { paused: (await readState()).daemonPaused });
      if (route === "POST /daemon/pause" || route === "POST /daemon/resume") {
        await commands.setDaemonPaused(route.endsWith("pause"));
        return json(res, 200, { ok: true });
      }
      if (route === "GET /events") return json(res, 200, events.list());
      if (route === "GET /events/stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": conectado\n\n");
        streams.add(res);
        const unsubscribe = events.subscribe((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
        req.on("close", () => {
          unsubscribe();
          streams.delete(res);
        });
        return;
      }
      if (route === "GET /openapi.json") return json(res, 200, API_SCHEMA);
      json(res, 404, { error: "rota inexistente" });
    } catch (err) {
      json(res, 500, { error: String(err) });
    }
  });

  /** Uma busca por vez, venha ela do timer ou da API. */
  let polling: Promise<void> = Promise.resolve();
  let pendingPolls = 0;
  function serializedPoll(): Promise<void> {
    pendingPolls++;
    const run = polling.then(poll).finally(() => pendingPolls--);
    polling = run.catch(() => undefined);
    return run;
  }
  // O timer pula o tick se ainda houver busca pendente, para não acumular buscas com a Fonte lenta.
  const pollTimer =
    opts.pollIntervalMs &&
    setInterval(() => {
      if (pendingPolls > 0) return;
      serializedPoll().catch((err) => console.error("[fábrica] erro na busca:", err));
    }, opts.pollIntervalMs);

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      closing = true;
      if (pollTimer) clearInterval(pollTimer);
      clearTimeout(retryTimer);
      for (const stream of streams) stream.end();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await polling;
      await reacting;
      observation.detach();
      await harness.close(context);
    },
  };
}
