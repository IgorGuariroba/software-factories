import type { Context } from "@earendil-works/chord/context";
import { defineDoc, defineEntry, defineTask, type JsonObject, type TaskId, type Tx } from "@earendil-works/pi-durable";
import type { FactoryEvent } from "./events.js";
import type { SpecDelivery } from "./spec-stage.js";

/** Status de uma Tarefa na fila. */
export type TaskStatus = "enfileirada" | "ativa" | "pausada" | "concluida" | "cancelada" | "bloqueada";

/** Uma Tarefa da fábrica, na ordem da fila. */
export type QueuedTask = {
  /** `<projeto>/<card>`. */
  id: string;
  project: string;
  key: string;
  title: string;
  status: TaskStatus;
  /** Task durável que executa a Tarefa, depois de ativada pela primeira vez. */
  durableId: number | null;
  /** Task "portão" em que a Tarefa espera enquanto está pausada. */
  gateId: number | null;
  /** O usuário pediu pausa; a Tarefa ativa para no próximo passo. */
  pauseRequested: boolean;
  /** Depois de uma falha, a Tarefa só volta a ser ativada a partir deste instante (ms). */
  notBefore: number | null;
  attempts: number;
  reason: string | null;
  /**
   * Entrega do modelo na etapa SPEC, guardada antes de publicar. Uma nova tentativa da Tarefa (ex.: o Jira caiu entre
   * a SPEC e os Tickets) republica a mesma entrega, sem chamar o modelo de novo nem trocar uma SPEC válida.
   */
  delivery?: SpecDelivery | null;
};

export type FactoryState = {
  daemonPaused: boolean;
  tasks: QueuedTask[];
};

/** Estado da fila e do daemon, durável na sessão. */
export const StateDoc = defineDoc<FactoryState>({
  kind: "fabrica.estado",
  version: 1,
  scope: "session",
  initial: () => ({ daemonPaused: false, tasks: [] }),
  checkpointWhen: () => true,
});

/** Um evento da fábrica, gravado no transcript da conversa raiz. */
export const EventEntry = defineEntry<JsonObject>("fabrica.evento");

/** Converte um evento para o JSON gravado no transcript (sem campos `undefined`). */
export const eventToJson = (event: FactoryEvent): JsonObject => JSON.parse(JSON.stringify(event)) as JsonObject;

/** Passos de uma Tarefa, na ordem em que acontecem. */
export type TarefaCheckpoint = { phase: "comentar" } | { phase: "transicionar" } | { phase: "spec" };

export type TarefaInput = {
  id: string;
  project: string;
  key: string;
};

/** O que cada passo faz e o que vem depois dele. */
/** O que um passo pode usar da task durável que o executa. */
export interface StepRuntime {
  taskId: TaskId;
  signal: AbortSignal;
  context: Context;
  /** Commit da task durável, sem mudar o estado dela (ex.: criar a conversa de uma etapa). */
  commit(change: (tx: Tx) => Promise<void>): Promise<void>;
}

export interface TarefaSteps {
  run(input: TarefaInput, step: TarefaCheckpoint["phase"], runtime: StepRuntime): Promise<void>;
  /** Classifica uma falha do passo: bloqueio de guardrail (definitivo) ou erro (tentar de novo). */
  classify(err: unknown): { kind: "blocked"; reason: string } | { kind: "error"; message: string };
  onError(input: TarefaInput, message: string): Promise<void>;
  retryDelayMs: number;
}

const NEXT: Record<TarefaCheckpoint["phase"], TarefaCheckpoint | "fim"> = {
  comentar: { phase: "transicionar" },
  transicionar: { phase: "spec" },
  spec: "fim",
};

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/** Task "portão": dorme até ser abortada. Uma Tarefa pausada espera por ela. */
export const GateTask = defineTask<Record<string, never>, { phase: "fechado" }, null>({
  name: "fabrica.portao",
  version: 1,
  initial: () => ({ phase: "fechado" }),
  phases: {
    fechado: (_task, runtime, context) =>
      runtime.sleepUntil(runtime.now() + TEN_YEARS_MS, { phase: "fechado" }, context),
  },
  abort: (_task, runtime, context) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

function findTask(state: FactoryState, id: string): QueuedTask {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Tarefa ${id} não está na fila`);
  return task;
}

/** Rejeita quando `signal` aborta (fechamento do daemon), para o passo não ficar preso numa chamada externa. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** A Tarefa durável: um passo por fase, com checkpoint ao fim de cada um. */
export function createTarefaTask(steps: TarefaSteps) {
  type Runtime = Parameters<Parameters<typeof defineTask<TarefaInput, TarefaCheckpoint, null>>[0]["abort"]>[1];

  async function phase(
    task: { id: TaskId; input: TarefaInput },
    step: TarefaCheckpoint["phase"],
    runtime: Runtime,
    context: Context,
  ): Promise<void> {
    // Pausa: se pedida (pelo usuário ou pelo daemon), espera num portão antes de começar o passo.
    let gated = false;
    await runtime.commit(async (tx) => {
      const state = await tx.doc(StateDoc);
      const queued = findTask(state, task.input.id);
      if (!state.daemonPaused && !queued.pauseRequested) return undefined;
      const gate = await tx.createTask(GateTask, {}, { ownership: { kind: "task", taskId: task.id } });
      queued.status = "pausada";
      queued.gateId = gate;
      gated = true;
      return { status: "waiting", checkpoint: { phase: step }, on: [gate], policy: "allSettled" };
    }, context);
    if (gated) return;

    try {
      const stepRuntime: StepRuntime = {
        taskId: task.id,
        signal: runtime.signal,
        context,
        commit: (change) =>
          runtime.commit(async (tx) => {
            await change(tx);
            return undefined;
          }, context),
      };
      await abortable(steps.run(task.input, step, stepRuntime), runtime.signal);
    } catch (err) {
      if (runtime.signal.aborted) throw err;
      const failure = steps.classify(err);
      if (failure.kind === "error") await steps.onError(task.input, failure.message);
      await runtime.commit(async (tx) => {
        const state = await tx.doc(StateDoc);
        const queued = findTask(state, task.input.id);
        if (failure.kind === "blocked") {
          queued.status = "bloqueada";
          queued.reason = failure.reason;
        } else {
          // Volta para o fim da fila; a próxima tentativa recomeça do primeiro passo, que é idempotente.
          const retry: QueuedTask = {
            ...(JSON.parse(JSON.stringify(queued)) as QueuedTask),
            status: "enfileirada",
            durableId: null,
            attempts: queued.attempts + 1,
            notBefore: runtime.now() + steps.retryDelayMs,
            reason: failure.message,
          };
          state.tasks = [...state.tasks.filter((t) => t.id !== retry.id), retry];
        }
        return { status: "terminal", outcome: { status: "completed", result: null } };
      }, context);
      return;
    }

    const next = NEXT[step];
    await runtime.commit(async (tx) => {
      if (next !== "fim") return { status: "running", checkpoint: next };
      findTask(await tx.doc(StateDoc), task.input.id).status = "concluida";
      return { status: "terminal", outcome: { status: "completed", result: null } };
    }, context);
  }

  return defineTask<TarefaInput, TarefaCheckpoint, null>({
    name: "fabrica.tarefa",
    version: 1,
    initial: () => ({ phase: "comentar" }),
    phases: {
      comentar: (task, runtime, context) => phase(task, "comentar", runtime, context),
      transicionar: (task, runtime, context) => phase(task, "transicionar", runtime, context),
      spec: (task, runtime, context) => phase(task, "spec", runtime, context),
    },
    abort: (task, runtime, context) =>
      runtime.commit(async (tx) => {
        const queued = (await tx.doc(StateDoc)).tasks.find((t) => t.id === task.input.id);
        if (queued) queued.status = "cancelada";
        return { status: "terminal", outcome: { status: "aborted" } };
      }, context),
  });
}
