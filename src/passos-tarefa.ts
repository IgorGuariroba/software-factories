import type { QueuedTask, TarefaCheckpoint, TaskStage } from "./durable.js";
import { decidirEscopoAlterado } from "./packages/spec-etapa/index.js";

// Catálogo dos passos da Tarefa: a ordem (NEXT), a etapa de cada passo (STAGE), o passo de cada retrô e a regra de
// escopo alterado por passo. As esperas e a execução ficam em durable.ts; aqui só fica a definição dos passos.

/** Passos comuns, executados por `TarefaSteps.run`; as esperas (`aguardar`, `veto`) são tratadas pela própria task. */
export type Step = Exclude<TarefaCheckpoint["phase"], "aguardar" | "veto">;

/** O passo da retrô de cada etapa de modelo; uma etapa nova entra aqui e em `NEXT`. */
export const RETRO_STEP = {
  triagem: "retro-triagem",
  spec: "retro-spec",
  implementacao: "retro-implementacao",
  review: "retro-review",
  mr: "retro-mr",
  tarefa: "retro-tarefa",
} as const;

export const NEXT: Record<Step, TarefaCheckpoint | "fim"> = {
  triar: { phase: RETRO_STEP.triagem },
  [RETRO_STEP.triagem]: { phase: "comentar" },
  comentar: { phase: "veto" },
  transicionar: { phase: "spec" },
  spec: { phase: RETRO_STEP.spec },
  [RETRO_STEP.spec]: { phase: "implementar" },
  implementar: { phase: RETRO_STEP.implementacao },
  [RETRO_STEP.implementacao]: { phase: "revisar" },
  revisar: { phase: RETRO_STEP.review },
  [RETRO_STEP.review]: { phase: "entregar" },
  entregar: { phase: RETRO_STEP.mr },
  [RETRO_STEP.mr]: { phase: RETRO_STEP.tarefa },
  [RETRO_STEP.tarefa]: "fim",
};

/** A etapa de cada passo comum. As retrôs não mudam a etapa: ficam na que avaliam. */
export const STAGE: Partial<Record<Step, TaskStage>> = {
  triar: "triagem",
  comentar: "assumir",
  transicionar: "assumir",
  spec: "spec",
  implementar: "implementacao",
  revisar: "review",
  entregar: "entrega",
};

/** Passos que acontecem antes da SPEC: a SPEC que vier depois já lê o card atual. */
const PRE_SPEC_STEPS: ReadonlySet<Step> = new Set<Step>([
  "triar",
  RETRO_STEP.triagem,
  "comentar",
  "transicionar",
  "spec",
]);

export type ScopeVerdict = "seguir" | "refazer-spec" | "bloquear";

/**
 * O que fazer com uma Tarefa cujo escopo mudou no GitHub, no limite de um passo. Antes da SPEC, segue. Depois dela e
 * sem código ainda, refaz a SPEC. Com a implementação iniciada, bloqueia: trocar a SPEC no meio dos commits deixaria o
 * progresso (indexado pelos tickets antigos) inconsistente, e essa decisão é do usuário.
 */
export function scopeGate(task: Pick<QueuedTask, "specDirty" | "implementation">, step: Step): ScopeVerdict {
  // A regra (antes da SPEC segue; depois refaz ou bloqueia) está no pacote spec-etapa; o catálogo de passos é daqui.
  return decidirEscopoAlterado(task, step, PRE_SPEC_STEPS);
}
