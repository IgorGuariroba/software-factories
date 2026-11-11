import type { Context } from "@earendil-works/chord/context";
import { defineTask, type TaskId, type Tx } from "@earendil-works/pi-durable";
import type { QueuedTask } from "./estado-fabrica.js";
import { pendingQuestion } from "./packages/perguntas/index.js";
import { esperaPessoa } from "./packages/tarefa/index.js";
import type { Step } from "./passos-tarefa.js";

export * from "./estado-fabrica.js";

/** Passos de uma Tarefa, na ordem em que acontecem. */
export type TarefaCheckpoint =
  /** Triagem da issue (só repositório monitorado; nos outros projetos, passa direto). */
  | { phase: "triar" }
  | { phase: "comentar" }
  /** Card que já estava em andamento: aviso ao usuário e espera do prazo de veto. Os outros passam direto. */
  | { phase: "veto" }
  | { phase: "transicionar" }
  | { phase: "spec" }
  /** Dormindo até a resposta de uma pessoa ou o próximo prazo de escalonamento. */
  | { phase: "aguardar" }
  | { phase: "implementar" }
  | { phase: "revisar" }
  | { phase: "entregar" }
  | { phase: "retro-triagem" }
  | { phase: "retro-review" }
  | { phase: "retro-mr" }
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

/** O que cada passo faz e o que vem depois dele. */
export interface TarefaSteps {
  /**
   * Executa um passo. `"aguardar"`: a Tarefa espera uma pessoa (pergunta, prévia) e dorme sem ocupar a fila.
   * `"recusada"`: a triagem deu baixa na issue; a Tarefa termina aí. `"adiar"`: aceita na triagem, mas sem vaga
   * (`maxActive`); volta à fila, no mesmo lugar, e tenta de novo depois.
   */
  run(
    input: TarefaInput,
    step: Step,
    runtime: StepRuntime,
  ): Promise<"aguardar" | "recusada" | "adiar" | "acompanhar" | undefined>;
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
  /** Próximo instante em que o projeto pode iniciar um passo. */
  availableAt?(input: TarefaInput): number;
}

export const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

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

export { RETRO_STEP, type ScopeVerdict, type Step, scopeGate } from "./passos-tarefa.js";

export const awaitsHuman = (task: QueuedTask): boolean => esperaPessoa(task, pendingQuestion(task) !== undefined);
