import type { Context } from "@earendil-works/chord/context";
import {
  type ConversationId,
  defineDoc,
  defineEntry,
  defineTask,
  type JsonObject,
  type TaskId,
  type Tx,
} from "@earendil-works/pi-durable";
import type { QuestionRef } from "./channel.js";
import type { CardState, TestCommand } from "./config.js";
import type { FactoryEvent } from "./events.js";
import type { SpecDelivery } from "./spec-stage.js";

/** Status de uma Tarefa na fila. */
export type TaskStatus =
  | "enfileirada"
  | "ativa"
  | "aguardando-humano"
  | "aguardando-veto"
  | "pausada"
  | "concluida"
  | "cancelada"
  | "bloqueada"
  | "vetada";

/** Prazo de veto de uma Tarefa cujo card já estava em andamento quando a fábrica o assumiu. */
export type VetoWindow = {
  /** Fim do prazo (ms, no relógio da fábrica). Um veto a partir daqui não vale mais. */
  until: number;
  /** O prazo venceu sem veto: a Tarefa segue para as etapas. */
  expired: boolean;
};

/** Uma pergunta de negócio da Tarefa ao PO, com os prazos de escalonamento já calculados em horas úteis. */
export type Question = {
  /** Número da pergunta na Tarefa (1, 2, …). */
  n: number;
  /** Quem levantou a pergunta: o grill ou a própria fábrica, diante de um card vazio ou raso. */
  origin: "grill" | "card-raso";
  /** Pessoa do projeto a quem foi feita. */
  to: string;
  text: string;
  /** Onde o Canal fez a pergunta. */
  ref: QuestionRef;
  askedAt: number;
  /** Lembrete à pessoa (4 h úteis depois da pergunta). */
  remindAt: number;
  /** Aviso ao usuário (1 dia útil depois da pergunta). */
  notifyAt: number;
  reminded: boolean;
  notified: boolean;
  answer: string | null;
  /** Rascunho de ensaio; `sending` indica resultado potencialmente incerto após uma interrupção. */
  publication?: "draft" | "sending" | "sent";
  /** Lembrete em revisão: rascunho aguardando aprovação, em envio (incerto se interrompido) ou enviado. */
  reminder?: "draft" | "sending" | "sent";
  /** A reserva antecede o envio; resultado incerto nunca é reenviado automaticamente. */
  teamsNotice?: { userId: string; link: string; status: "pending" | "attempted" | "sent" | "uncertain" };
};

/** Etapa em que a Tarefa está (ou a última em que esteve), para as interfaces de gestão. */
export type TaskStage = "assumir" | "veto" | "spec" | "implementacao";

/** De que a retrô trata: uma etapa de modelo, ou a Tarefa inteira (a consolidada). */
export type RetroStage = "spec" | "implementacao" | "tarefa";

/** Os três tipos de proposta de retrô (SPEC, "Retrô"). */
export type RetroKind = "fabrica" | "conhecimento" | "repo-time";

/** Situação de uma proposta de retrô. */
export type RetroProposalStatus =
  /** Ainda não publicada (a retrô foi interrompida antes). */
  | "a-publicar"
  /** fábrica: abriu uma issue `retro`. */
  | "issue-criada"
  /** fábrica: comentou "+1" numa issue parecida já aberta. */
  | "mais-um"
  /** fábrica: uma issue parecida já citava esta Tarefa; nada a escrever. */
  | "ja-registrada"
  /** fábrica: no dry-run, a escrita só ficou registrada. */
  | "dry-run"
  /** fábrica: sem repositório da fábrica configurado (`FACTORY_RETRO_REPO`); só registrada. */
  | "sem-repo"
  /** fábrica: o escritor de efeitos barrou a escrita (ver `reason`). */
  | "bloqueada"
  /** conhecimento do projeto: aguarda aprovação do usuário. */
  | "pendente"
  /** repo do time: virou aviso ao usuário. */
  | "avisada";

export type RetroProposal = {
  n: number;
  kind: RetroKind;
  title: string;
  description: string;
  status: RetroProposalStatus;
  /** A issue aberta ou comentada (fábrica). */
  issue: { number: number; url: string } | null;
  reason: string | null;
};

/**
 * Uma retrô. A entrega do modelo é gravada antes de publicar: uma nova tentativa só publica o que falta, sem chamar o
 * modelo de novo.
 */
export type RetroRecord = {
  stage: RetroStage;
  status: "em-andamento" | "concluida" | "falhou";
  /** Tentativas que falharam; no limite, a retrô desiste (`falhou`) sem bloquear a Tarefa. */
  attempts: number;
  error: string | null;
  conversationId: ConversationId | null;
  /** Resumo do modelo; `null` até a entrega. */
  summary: string | null;
  /** Propostas classificadas; `null` até a entrega. */
  proposals: RetroProposal[] | null;
};

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
  /** Task "portão" em que a Tarefa espera enquanto está pausada ou aguardando uma pessoa. */
  gateId: number | null;
  /** O usuário pediu pausa; a Tarefa ativa para no próximo passo. */
  pauseRequested: boolean;
  /** Depois de uma falha, a Tarefa só volta a ser ativada a partir deste instante (ms). */
  notBefore: number | null;
  attempts: number;
  reason: string | null;
  /** Estado do card quando a fábrica o enfileirou. Um card que já estava `in_progress` passa pelo prazo de veto. */
  startedIn?: CardState;
  /** Etapa atual; sem ela, a Tarefa ainda não começou. */
  stage?: TaskStage | null;
  /** Prazo de veto, aberto depois do comentário de assunção de um card que já estava em andamento. */
  veto?: VetoWindow | null;
  /**
   * Entrega do modelo na etapa SPEC, guardada antes de publicar. Uma nova tentativa da Tarefa (ex.: o Jira caiu entre
   * a SPEC e os Tickets) republica a mesma entrega, sem chamar o modelo de novo nem trocar uma SPEC válida.
   */
  delivery?: SpecDelivery | null;
  /** Perguntas ao PO, na ordem; a última sem resposta é a que a Tarefa aguarda. */
  questions?: Question[];
  /** Revisão da SPEC/Tickets antes de publicar: rascunho aguardando aprovação, ou aprovada. */
  specReview?: "draft" | "approved";
  /** Etapas cuja retrô já segurou a Tarefa (`retroApproval`); retomada ou nova tentativa não seguram de novo. */
  retroHeld?: ("spec" | "implementacao")[];
  /** Progresso da etapa de implementação, gravado a cada passo para a retomada não refazer nem duplicar nada. */
  implementation?: ImplementationProgress | null;
  /**
   * Identificador opaco e estável da Tarefa, sem relação com o projeto nem com o card: é a única referência a ela que
   * sai para o repositório público da fábrica.
   */
  ref?: string;
  /** Retrôs das etapas e a consolidada, na ordem em que aconteceram. */
  retros?: RetroRecord[];
};

/** Uma fase do ciclo TDD de um ticket: o teste que falha, depois o código que o faz passar. */
export type TddPhase = "teste" | "implementacao";

export type ImplementationProgress = {
  /** Cópia do usuário de onde o clone foi feito; a fábrica só lê dela. */
  repoPath: string;
  /** Clone próprio da fábrica, sob o diretório de estado. As ferramentas do modelo só enxergam este diretório. */
  worktree: string;
  /** A branch desta Tarefa. A fábrica só aceita force-push nela se a criou (`branchOrigin: "criada"`). */
  branch: string;
  /**
   * Se a fábrica criou a branch ou adotou uma que já existia no remoto com o nome da convenção (que pode ser de uma
   * pessoa). Sem o campo (progresso antigo), a branch não conta como da fábrica.
   */
  branchOrigin?: "criada" | "adotada";
  /** Padrão de commit resolvido no início da etapa (descoberto no histórico ou da config). */
  commitPattern: string;
  /** Comando de teste do repositório, fixado no início da etapa. */
  test: TestCommand;
  /** Conversa do implementador; as ferramentas acham a Tarefa (e o clone) por ela. */
  conversationId: ConversationId;
  /** HEAD depois do último commit registrado. Um HEAD diferente na retomada é um commit que caiu antes do registro. */
  head: string;
  /** Commits feitos, na ordem: um por fase de cada ticket. */
  commits: { ticket: number; phase: TddPhase; sha: string }[];
  /** Pedidos feitos ao modelo; numera o próximo para que uma nova tentativa não reaproveite um pedido recusado. */
  requests: number;
  /**
   * Resultado da linha de base: a suíte rodada uma vez, antes do primeiro teste novo. Registrado para a retomada não
   * rodá-la de novo (com o teste novo já no clone, ela falharia). `null`: ainda não rodou.
   */
  baseline?: "verde" | "vermelha" | null;
  /** Recusas seguidas da fábrica na fase atual (ex.: o teste novo não falhou). */
  rejections: number;
  /** Por que a fábrica recusou a última tentativa; vai junto do próximo pedido. */
  feedback: string | null;
  pushed: boolean;
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

/** Progresso de uma interface de gestão: o que já foi publicado e o que já foi recebido. */
export type ManagementProgress = {
  /** Próximo evento do log a publicar (índice). `null`: interface nova, começa pelos eventos que vierem. */
  eventCursor: number | null;
  /** Próximo update a receber (no Telegram, o `offset` do `getUpdates`). */
  updateOffset: number;
  /** Instante do último comando ou reinício preventivo da sequência. */
  lastUpdateAt?: number;
};

/** Progresso de cada interface de gestão, pelo nome dela: um reinício não republica nem reprocessa nada. */
export const ManagementDoc = defineDoc<Record<string, ManagementProgress>>({
  kind: "fabrica.gestao",
  version: 1,
  scope: "session",
  initial: () => ({}),
  checkpointWhen: () => true,
});

/** Um evento da fábrica, gravado no transcript da conversa raiz. */
export const EventEntry = defineEntry<JsonObject>("fabrica.evento");

/**
 * Cópia solta de um valor do estado durável. O rascunho que `tx.doc` devolve num commit não pode ser usado depois
 * dele: o que sai do commit (ou volta para outro lugar do documento) é sempre esta cópia, nunca o próprio rascunho.
 */
export const copyOutOfCommit = <T>(draft: T): T => JSON.parse(JSON.stringify(draft)) as T;

/** Converte um evento para o JSON gravado no transcript (sem campos `undefined`). */
export const eventToJson = (event: FactoryEvent): JsonObject => JSON.parse(JSON.stringify(event)) as JsonObject;

/** Passos de uma Tarefa, na ordem em que acontecem. */
export type TarefaCheckpoint =
  | { phase: "comentar" }
  /** Card que já estava em andamento: aviso ao usuário e espera do prazo de veto. Os outros passam direto. */
  | { phase: "veto" }
  | { phase: "transicionar" }
  | { phase: "spec" }
  /** Dormindo até a resposta de uma pessoa ou o próximo prazo de escalonamento. */
  | { phase: "aguardar" }
  | { phase: "implementar" }
  /** Retrôs: uma ao fim de cada etapa de modelo e a consolidada ao fim da Tarefa. */
  | { phase: "retro-spec" }
  | { phase: "retro-implementacao" }
  | { phase: "retro-tarefa" };

export type TarefaInput = {
  id: string;
  project: string;
  key: string;
};

/** A inspeção do repositório achou o card já implementado: a Tarefa fica bloqueada com o motivo. */
export class InspectionBlocked extends Error {}

/** O que cada passo faz e o que vem depois dele. */
/** O que um passo pode usar da task durável que o executa. */
export interface StepRuntime {
  taskId: TaskId;
  signal: AbortSignal;
  context: Context;
  /** Relógio da fábrica (o falso, nos testes). */
  now(): number;
  /** Commit da task durável, sem mudar o estado dela (ex.: criar a conversa de uma etapa). */
  commit(change: (tx: Tx) => Promise<void>): Promise<void>;
}

export interface TarefaSteps {
  /** Executa um passo. `"aguardar"`: a Tarefa fez uma pergunta e dorme até a resposta, sem ocupar a fila. */
  run(input: TarefaInput, step: Step, runtime: StepRuntime): Promise<"aguardar" | undefined>;
  /**
   * Inspeção de um card que já estava em andamento, no lugar do prazo de veto: `"seguir"` (nada feito antes no
   * repositório), `"bloquear"` (já implementado) ou `"veto"` (sem repositório para inspecionar: espera o prazo).
   */
  inspect(input: TarefaInput): Promise<{ kind: "seguir" } | { kind: "bloquear"; reason: string } | { kind: "veto" }>;
  /** Duração do prazo de veto do projeto da Tarefa (ms). */
  vetoMs(input: TarefaInput): number;
  /** Avisa o usuário de que a Tarefa assumiu um card em andamento e espera um veto até `until` (ms). */
  announceVeto(input: TarefaInput, until: number): Promise<void>;
  /**
   * Acordada por um prazo enquanto aguarda: confere se a resposta chegou (e a registra) e faz o escalonamento vencido.
   * Retorna quando acordar de novo (ms), ou `null` se não houver mais prazo.
   */
  escalate(input: TarefaInput, runtime: StepRuntime): Promise<number | null>;
  /** Classifica uma falha do passo: bloqueio de guardrail (definitivo) ou erro (tentar de novo). */
  classify(err: unknown): { kind: "blocked"; reason: string } | { kind: "error"; message: string };
  onError(input: TarefaInput, message: string): Promise<void>;
  retryDelayMs: number;
}

/** Passos comuns, executados por `TarefaSteps.run`; as esperas (`aguardar`, `veto`) são tratadas pela própria task. */
export type Step = Exclude<TarefaCheckpoint["phase"], "aguardar" | "veto">;

/** O passo da retrô de cada etapa de modelo; uma etapa nova entra aqui e em `NEXT`. */
export const RETRO_STEP = { spec: "retro-spec", implementacao: "retro-implementacao", tarefa: "retro-tarefa" } as const;

const NEXT: Record<Step, TarefaCheckpoint | "fim"> = {
  comentar: { phase: "veto" },
  transicionar: { phase: "spec" },
  spec: { phase: RETRO_STEP.spec },
  [RETRO_STEP.spec]: { phase: "implementar" },
  implementar: { phase: RETRO_STEP.implementacao },
  [RETRO_STEP.implementacao]: { phase: RETRO_STEP.tarefa },
  [RETRO_STEP.tarefa]: "fim",
};

/** A etapa de cada passo comum. As retrôs não mudam a etapa: ficam na que avaliam. */
const STAGE: Partial<Record<Step, TaskStage>> = {
  comentar: "assumir",
  transicionar: "assumir",
  spec: "spec",
  implementar: "implementacao",
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

/** Task "prazo": como o portão, mas abre sozinha em `until`. A Tarefa que aguarda uma pessoa dorme nela. */
export const DeadlineGateTask = defineTask<{ until: number }, { phase: "fechado" }, null>({
  name: "fabrica.prazo",
  version: 1,
  initial: () => ({ phase: "fechado" }),
  phases: {
    fechado: (task, runtime, context) =>
      runtime.now() >= task.input.until
        ? runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context)
        : runtime.sleepUntil(task.input.until, { phase: "fechado" }, context),
  },
  abort: (_task, runtime, context) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

/**
 * Registra a resposta da pergunta `n` e devolve a Tarefa à fila (ou à pausa, se o usuário a pausou enquanto ela
 * aguardava). Ela volta a rodar quando chegar a vez dela, como uma Tarefa retomada.
 */
export function recordAnswer(state: FactoryState, id: string, n: number, answer: string): boolean {
  const queued = state.tasks.find((t) => t.id === id);
  const question = queued?.questions?.find((q) => q.n === n);
  if (!queued || !question || question.answer !== null) return false;
  question.answer = answer;
  if (queued.status === "aguardando-humano") queued.status = queued.pauseRequested ? "pausada" : "enfileirada";
  return true;
}

/** Se a Tarefa espera uma pessoa: resposta de pergunta ou aprovação da SPEC. */
export const awaitsHuman = (task: QueuedTask): boolean =>
  pendingQuestion(task) !== undefined || task.specReview === "draft";

/** A pergunta que a Tarefa aguarda: a última, se ainda não tem resposta. */
export const pendingQuestion = (task: QueuedTask): Question | undefined => {
  const last = task.questions?.at(-1);
  return last && last.answer === null ? last : undefined;
};

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
  async function fail(task: TaskRef, err: unknown, runtime: Runtime, context: Context): Promise<void> {
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

  async function phase(task: TaskRef, step: Step, runtime: Runtime, context: Context): Promise<void> {
    // Pausa: se pedida (pelo usuário ou pelo daemon), espera num portão antes de começar o passo.
    let gated = false;
    await runtime.commit(async (tx) => {
      const state = await tx.doc(StateDoc);
      const queued = findTask(state, task.input.id);
      if (!state.daemonPaused && !queued.pauseRequested) {
        const stage = STAGE[step];
        if (stage) queued.stage = stage;
        return undefined;
      }
      const gate = await tx.createTask(GateTask, {}, { ownership: { kind: "task", taskId: task.id } });
      queued.status = "pausada";
      queued.gateId = gate;
      gated = true;
      return { status: "waiting", checkpoint: { phase: step }, on: [gate], policy: "allSettled" };
    }, context);
    if (gated) return;

    let outcome: "aguardar" | undefined;
    try {
      outcome = await abortable(steps.run(task.input, step, stepRuntimeOf(task, runtime, context)), runtime.signal);
    } catch (err) {
      return fail(task, err, runtime, context);
    }

    const next = outcome === "aguardar" ? { phase: "aguardar" as const } : NEXT[step];
    await runtime.commit(async (tx) => {
      if (next !== "fim") return { status: "running", checkpoint: next };
      findTask(await tx.doc(StateDoc), task.input.id).status = "concluida";
      return { status: "terminal", outcome: { status: "completed", result: null } };
    }, context);
  }

  /**
   * Espera por uma pessoa. A Tarefa sai da fila (`aguardando-humano`) e dorme numa task "prazo" até o próximo prazo de
   * escalonamento. A resposta, achada pela busca na Fonte ou ao acordar num prazo, devolve a Tarefa à fila; quando
   * chega a vez dela, o agendador abre o prazo e ela volta à etapa SPEC com a resposta.
   */
  async function awaitHuman(task: TaskRef, runtime: Runtime, context: Context): Promise<void> {
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
        return fail(task, err, runtime, context);
      }
    }

    await runtime.commit(async (tx) => {
      const queued = findTask(await tx.doc(StateDoc), task.input.id);
      // A resposta chegou e é a vez desta Tarefa: volta à SPEC.
      if (queued.status === "ativa" && !awaitsHuman(queued))
        return { status: "running", checkpoint: { phase: "spec" } };
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
  async function awaitVeto(task: TaskRef, runtime: Runtime, context: Context): Promise<void> {
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
        return fail(task, err, runtime, context);
      }
      if (inspection.kind === "bloquear") return fail(task, new InspectionBlocked(inspection.reason), runtime, context);
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
      return fail(task, err, runtime, context);
    }
    await runtime.commit(async (tx) => {
      const queued = findTask(await tx.doc(StateDoc), task.input.id);
      queued.status = "aguardando-veto";
      return sleepUntil(tx, queued, until);
    }, context);
  }

  return defineTask<TarefaInput, TarefaCheckpoint, null>({
    name: "fabrica.tarefa",
    version: 1,
    initial: () => ({ phase: "comentar" }),
    phases: {
      comentar: (task, runtime, context) => phase(task, "comentar", runtime, context),
      veto: (task, runtime, context) => awaitVeto(task, runtime, context),
      transicionar: (task, runtime, context) => phase(task, "transicionar", runtime, context),
      spec: (task, runtime, context) => phase(task, "spec", runtime, context),
      aguardar: (task, runtime, context) => awaitHuman(task, runtime, context),
      implementar: (task, runtime, context) => phase(task, "implementar", runtime, context),
      "retro-spec": (task, runtime, context) => phase(task, "retro-spec", runtime, context),
      "retro-implementacao": (task, runtime, context) => phase(task, "retro-implementacao", runtime, context),
      "retro-tarefa": (task, runtime, context) => phase(task, "retro-tarefa", runtime, context),
    },
    abort: (task, runtime, context) =>
      runtime.commit(async (tx) => {
        const queued = (await tx.doc(StateDoc)).tasks.find((t) => t.id === task.input.id);
        if (queued) queued.status = "cancelada";
        return { status: "terminal", outcome: { status: "aborted" } };
      }, context),
  });
}
