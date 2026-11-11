import type { Context } from "@earendil-works/chord/context";
import { defineTask, type TaskId, type Tx } from "@earendil-works/pi-durable";
import {
  awaitsHuman,
  DeadlineGateTask,
  GateTask,
  InspectionBlocked,
  type Step,
  type StepRuntime,
  type TarefaCheckpoint,
  type TarefaInput,
  type TarefaSteps,
  TEN_YEARS_MS,
} from "./durable.js";
import { copyOutOfCommit, type FactoryState, type QueuedTask, StateDoc, tarefaDoEstado } from "./estado-fabrica.js";
import { pendingQuestion } from "./packages/perguntas/index.js";
import { NEXT, type ScopeVerdict, STAGE, scopeGate } from "./passos-tarefa.js";
import { projetoPausado } from "./projeto-pausa.js";
import { repoDesativado } from "./repositorios.js";

// A Tarefa durável: a máquina de passos (triagem, SPEC, implementação, revisão, entrega e retrôs) com checkpoint ao fim
// de cada um, as esperas por uma pessoa e pelo prazo de veto, e a falha que bloqueia ou devolve a Tarefa à fila.

/** Rejeita quando `signal` aborta (fechamento do daemon), para o passo não ficar preso numa chamada externa. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function findTask(state: FactoryState, id: string): QueuedTask {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Tarefa ${id} não está na fila`);
  return task;
}

/** A Tarefa durável: um passo por fase, com checkpoint ao fim de cada um. */
type Runtime = Parameters<Parameters<typeof defineTask<TarefaInput, TarefaCheckpoint, null>>[0]["abort"]>[1];

type TaskRef = { id: TaskId; input: TarefaInput };

const stepRuntimeOf = (task: TaskRef, runtime: Runtime, context: Context): StepRuntime => ({
  taskId: task.id,
  signal: runtime.signal,
  context,
  now: () => runtime.now(),
  commit: (change) =>
    runtime.commit(async (tx) => {
      await change(tx);
      return undefined;
    }, context),
});

/** Encerra a task durável depois de uma falha: bloqueia a Tarefa ou a devolve ao fim da fila para nova tentativa. */
async function fail(
  steps: TarefaSteps,
  task: TaskRef,
  err: unknown,
  runtime: Runtime,
  context: Context,
): Promise<void> {
  if (runtime.signal.aborted) throw err;
  const failure = steps.classify(err);
  if (failure.kind === "error") await steps.onError(task.input, failure.message);
  await runtime.commit(async (tx) => {
    const state = await tx.doc(StateDoc);
    const queued = findTask(state, task.input.id);
    if (failure.kind === "blocked") {
      queued.status = "bloqueada";
      queued.reason = failure.reason;
      queued.gateId = null;
    } else {
      // Volta para o fim da fila; a próxima tentativa recomeça do primeiro passo, que é idempotente.
      const retry: QueuedTask = {
        ...copyOutOfCommit(queued),
        status: "enfileirada",
        durableId: null,
        gateId: null,
        attempts: queued.attempts + 1,
        notBefore: runtime.now() + steps.retryDelayMs,
        reason: failure.message,
      };
      state.tasks = [...state.tasks.filter((t) => t.id !== retry.id), retry];
    }
    return { status: "terminal", outcome: { status: "completed", result: null } };
  }, context);
}

async function phase(steps: TarefaSteps, task: TaskRef, step: Step, runtime: Runtime, context: Context): Promise<void> {
  if (await aguardarPortao(steps, task, step, runtime, context)) return;
  // Escopo alterado no GitHub: antes da SPEC segue; depois, refaz a SPEC ou para (ver `scopeGate`).
  if ((await verificarEscopo(task, step, runtime, context)) !== "seguir") return;

  let outcome: "aguardar" | "recusada" | "adiar" | "acompanhar" | undefined;
  try {
    outcome = await abortable(steps.run(task.input, step, stepRuntimeOf(task, runtime, context)), runtime.signal);
  } catch (err) {
    return fail(steps, task, err, runtime, context);
  }
  if (outcome === "acompanhar") return aguardarEntrega(task, step, runtime, context);
  if (outcome === "adiar") return devolverAFilaSemTentativa(steps, task, runtime, context);
  return avancarPasso(task, step, outcome, runtime, context);
}

/**
 * Pausa: se pedida (pelo usuário ou pelo daemon) ou se a Tarefa ainda não pode rodar, espera num portão antes do passo.
 * Devolve `true` quando a Tarefa ficou esperando, e o passo não roda.
 */
async function aguardarPortao(
  steps: TarefaSteps,
  task: TaskRef,
  step: Step,
  runtime: Runtime,
  context: Context,
): Promise<boolean> {
  let gated = false;
  await runtime.commit(async (tx) => {
    const state = await tx.doc(StateDoc);
    const queued = findTask(state, task.input.id);
    const availableAt = steps.availableAt?.(task.input) ?? runtime.now();
    // Repositório desativado segura a Tarefa mesmo que ela tenha sido retomada (ADR-0015).
    if (
      !state.daemonPaused &&
      !queued.pauseRequested &&
      availableAt <= runtime.now() &&
      !repoDesativado(state, queued.project) &&
      !projetoPausado(state, queued.project)
    ) {
      // A SPEC lê o card a partir daqui: uma mudança que chegar depois marca o escopo de novo.
      if (step === "spec") queued.specDirty = false;
      const stage = STAGE[step];
      if (stage) queued.stage = stage;
      return undefined;
    }
    const gate = await tx.createTask(GateTask, {}, { ownership: { kind: "task", taskId: task.id } });
    queued.status =
      availableAt > runtime.now() &&
      !state.daemonPaused &&
      !queued.pauseRequested &&
      !projetoPausado(state, queued.project)
        ? "enfileirada"
        : "pausada";
    if (availableAt > runtime.now()) queued.notBefore = availableAt;
    queued.gateId = gate;
    gated = true;
    return { status: "waiting", checkpoint: { phase: step }, on: [gate], policy: "allSettled" };
  }, context);
  return gated;
}

/**
 * Escopo alterado no GitHub, no limite de um passo: antes da SPEC segue; depois dela e sem código, refaz a SPEC; com a
 * implementação iniciada, bloqueia. Devolve o veredito; quando não é `seguir`, a Tarefa já foi reposta pelo commit.
 */
async function verificarEscopo(task: TaskRef, step: Step, runtime: Runtime, context: Context): Promise<ScopeVerdict> {
  let verdict: ScopeVerdict = "seguir";
  await runtime.commit(async (tx) => {
    const queued = findTask(await tx.doc(StateDoc), task.input.id);
    verdict = scopeGate(queued, step);
    if (verdict === "seguir") return undefined;
    if (verdict === "refazer-spec") {
      queued.delivery = null;
      queued.specRevision = (queued.specRevision ?? 0) + 1;
      return { status: "running", checkpoint: { phase: "spec" } };
    }
    queued.status = "bloqueada";
    queued.reason = "escopo alterado depois do início da implementação; revise o card e recrie a Tarefa";
    queued.gateId = null;
    return { status: "terminal", outcome: { status: "completed", result: null } };
  }, context);
  return verdict;
}

/** Acompanhar a PR/MR: a Tarefa dorme num portão de um minuto e volta à entrega até o fim do acompanhamento. */
async function aguardarEntrega(task: TaskRef, step: Step, runtime: Runtime, context: Context): Promise<void> {
  await runtime.commit(async (tx) => {
    const queued = findTask(await tx.doc(StateDoc), task.input.id);
    queued.status = "aguardando-entrega";
    queued.notBefore = runtime.now() + 60_000;
    const gate = await tx.createTask(GateTask, {}, { ownership: { kind: "task", taskId: task.id } });
    queued.gateId = gate;
    return { status: "waiting", checkpoint: { phase: step }, on: [gate], policy: "allSettled" };
  }, context);
}

/** Sem vaga (maxActive): volta à fila no mesmo lugar (a mais antiga segue primeiro), sem contar tentativa. */
async function devolverAFilaSemTentativa(
  steps: TarefaSteps,
  task: TaskRef,
  runtime: Runtime,
  context: Context,
): Promise<void> {
  await runtime.commit(async (tx) => {
    const state = await tx.doc(StateDoc);
    const queued = findTask(state, task.input.id);
    const later: QueuedTask = {
      ...copyOutOfCommit(queued),
      status: "enfileirada",
      durableId: null,
      gateId: null,
      notBefore: runtime.now() + steps.retryDelayMs,
      reason: "aceita na triagem; espera vaga (maxActive)",
    };
    state.tasks = state.tasks.map((t) => (t.id === later.id ? later : t));
    return { status: "terminal", outcome: { status: "completed", result: null } };
  }, context);
}

/** Próximo checkpoint depois de um passo: a espera humana, o passo seguinte, ou o fim (concluída ou recusada). */
async function avancarPasso(
  task: TaskRef,
  step: Step,
  outcome: "aguardar" | "recusada" | undefined,
  runtime: Runtime,
  context: Context,
): Promise<void> {
  const next = outcome === "aguardar" ? { phase: "aguardar" as const } : outcome === "recusada" ? "fim" : NEXT[step];
  await runtime.commit(async (tx) => {
    if (next !== "fim") return { status: "running", checkpoint: next };
    findTask(await tx.doc(StateDoc), task.input.id).status = outcome === "recusada" ? "recusada" : "concluida";
    return { status: "terminal", outcome: { status: "completed", result: null } };
  }, context);
}

/**
 * Espera por uma pessoa. A Tarefa sai da fila (`aguardando-humano`) e dorme numa task "prazo" até o próximo prazo de
 * escalonamento. A resposta, achada pela busca na Fonte ou ao acordar num prazo, devolve a Tarefa à fila; quando
 * chega a vez dela, o agendador abre o prazo e ela volta à etapa SPEC com a resposta.
 */
async function awaitHuman(steps: TarefaSteps, task: TaskRef, runtime: Runtime, context: Context): Promise<void> {
  let first = false;
  let waiting = false;
  await runtime.commit(async (tx) => {
    const queued = findTask(await tx.doc(StateDoc), task.input.id);
    first = queued.status === "ativa" && awaitsHuman(queued);
    waiting = queued.status === "aguardando-humano" && pendingQuestion(queued) !== undefined;
    return undefined;
  }, context);

  let wakeAt: number | null = null;
  if (first) {
    // Acabou de perguntar: o primeiro prazo é o lembrete.
    await runtime.commit(async (tx) => {
      const question = pendingQuestion(findTask(await tx.doc(StateDoc), task.input.id));
      wakeAt = question ? question.remindAt : null;
      return undefined;
    }, context);
  } else if (waiting) {
    try {
      wakeAt = await abortable(steps.escalate(task.input, stepRuntimeOf(task, runtime, context)), runtime.signal);
    } catch (err) {
      return fail(steps, task, err, runtime, context);
    }
  }

  await runtime.commit(async (tx) => {
    const queued = findTask(await tx.doc(StateDoc), task.input.id);
    // A resposta chegou e é a vez desta Tarefa: volta à etapa que esperava (triagem ou SPEC).
    if (queued.status === "ativa" && !awaitsHuman(queued))
      return {
        status: "running",
        checkpoint: {
          phase: queued.stage === "triagem" ? "triar" : queued.stage === "implementacao" ? "implementar" : "spec",
        },
      };
    if (queued.status === "ativa") queued.status = "aguardando-humano";
    const until = pendingQuestion(queued) && wakeAt !== null ? wakeAt : runtime.now() + TEN_YEARS_MS;
    const gate = await tx.createTask(DeadlineGateTask, { until }, { ownership: { kind: "task", taskId: task.id } });
    queued.gateId = gate;
    return { status: "waiting", checkpoint: { phase: "aguardar" }, on: [gate], policy: "allSettled" };
  }, context);
}

/**
 * Prazo de veto de um card que já estava em andamento. A Tarefa avisa o usuário, sai da fila (`aguardando-veto`) e
 * dorme numa task "prazo" até o fim do prazo. Um veto nesse meio-tempo a deixa `vetada` e abre o prazo: ela acorda
 * só para terminar, sem tocar no card. Sem veto, ela volta à fila e, na vez dela, segue para as etapas. Cards que
 * estavam "a fazer" passam direto para a transição.
 */
async function awaitVeto(steps: TarefaSteps, task: TaskRef, runtime: Runtime, context: Context): Promise<void> {
  /** A Task "prazo" em que a Tarefa espera, fora da fila, até `until`. */
  const sleepUntil = async (tx: Tx, queued: QueuedTask, until: number) => {
    const gate = await tx.createTask(DeadlineGateTask, { until }, { ownership: { kind: "task", taskId: task.id } });
    queued.gateId = gate;
    return {
      status: "waiting" as const,
      checkpoint: { phase: "veto" as const },
      on: [gate],
      policy: "allSettled" as const,
    };
  };

  let fresh = false;
  await runtime.commit(async (tx) => {
    const queued = findTask(await tx.doc(StateDoc), task.input.id);
    fresh = queued.startedIn === "in_progress" && queued.status === "ativa" && !queued.veto;
    return undefined;
  }, context);
  if (fresh) {
    let inspection: Awaited<ReturnType<TarefaSteps["inspect"]>>;
    try {
      inspection = await abortable(steps.inspect(task.input), runtime.signal);
    } catch (err) {
      return fail(steps, task, err, runtime, context);
    }
    if (inspection.kind === "bloquear")
      return fail(steps, task, new InspectionBlocked(inspection.reason), runtime, context);
    if (inspection.kind === "seguir") {
      await runtime.commit(async (tx) => {
        const queued = findTask(await tx.doc(StateDoc), task.input.id);
        queued.stage = "veto";
        queued.veto = { until: runtime.now(), expired: true };
        return { status: "running", checkpoint: { phase: "spec" } };
      }, context);
      return;
    }
  }

  let announce: number | null = null;
  await runtime.commit(async (tx) => {
    const queued = findTask(await tx.doc(StateDoc), task.input.id);
    if (queued.startedIn !== "in_progress") return { status: "running", checkpoint: { phase: "transicionar" } };
    queued.stage = "veto";
    if (queued.status === "vetada") {
      queued.gateId = null;
      return { status: "terminal", outcome: { status: "completed", result: null } };
    }
    const now = runtime.now();
    if (queued.status === "ativa") {
      // Já estava em andamento: não há transição a fazer.
      if (queued.veto?.expired) return { status: "running", checkpoint: { phase: "spec" } };
      queued.veto ??= { until: now + steps.vetoMs(task.input), expired: false };
      announce = queued.veto.until;
      return undefined;
    }
    const veto = queued.veto;
    if (queued.status === "aguardando-veto" && veto && now >= veto.until) {
      // Sem veto no prazo: volta à fila e segue quando for a vez dela.
      veto.expired = true;
      queued.status = queued.pauseRequested ? "pausada" : "enfileirada";
    }
    return sleepUntil(tx, queued, queued.status === "aguardando-veto" && veto ? veto.until : now + TEN_YEARS_MS);
  }, context);
  if (announce === null) return;

  const until: number = announce;
  try {
    await abortable(steps.announceVeto(task.input, until), runtime.signal);
  } catch (err) {
    return fail(steps, task, err, runtime, context);
  }
  await runtime.commit(async (tx) => {
    const queued = findTask(await tx.doc(StateDoc), task.input.id);
    queued.status = "aguardando-veto";
    return sleepUntil(tx, queued, until);
  }, context);
}

export function createTarefaTask(steps: TarefaSteps) {
  return defineTask<TarefaInput, TarefaCheckpoint, null>({
    name: "fabrica.tarefa",
    version: 1,
    initial: () => ({ phase: "triar" }),
    phases: {
      triar: (task, runtime, context) => phase(steps, task, "triar", runtime, context),
      comentar: (task, runtime, context) => phase(steps, task, "comentar", runtime, context),
      veto: (task, runtime, context) => awaitVeto(steps, task, runtime, context),
      transicionar: (task, runtime, context) => phase(steps, task, "transicionar", runtime, context),
      spec: (task, runtime, context) => phase(steps, task, "spec", runtime, context),
      aguardar: (task, runtime, context) => awaitHuman(steps, task, runtime, context),
      implementar: (task, runtime, context) => phase(steps, task, "implementar", runtime, context),
      revisar: (task, runtime, context) => phase(steps, task, "revisar", runtime, context),
      entregar: (task, runtime, context) => phase(steps, task, "entregar", runtime, context),
      "retro-triagem": (task, runtime, context) => phase(steps, task, "retro-triagem", runtime, context),
      "retro-review": (task, runtime, context) => phase(steps, task, "retro-review", runtime, context),
      "retro-mr": (task, runtime, context) => phase(steps, task, "retro-mr", runtime, context),
      "retro-spec": (task, runtime, context) => phase(steps, task, "retro-spec", runtime, context),
      "retro-implementacao": (task, runtime, context) => phase(steps, task, "retro-implementacao", runtime, context),
      "retro-tarefa": (task, runtime, context) => phase(steps, task, "retro-tarefa", runtime, context),
    },
    abort: (task, runtime, context) =>
      runtime.commit(async (tx) => {
        const queued = tarefaDoEstado(await tx.doc(StateDoc), task.input.id);
        if (queued) queued.status = "cancelada";
        return { status: "terminal", outcome: { status: "aborted" } };
      }, context),
  });
}
