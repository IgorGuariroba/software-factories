import type { QueuedTask } from "./durable.js";
import { baselineBlockedReason, baselineWorkspaceBlockedReason } from "./implement-stage.js";

/** A mesma elegibilidade serve ao comando e à interface; outros guardrails não são retomáveis. */
export function blockedResumeKind(
  task: Pick<QueuedTask, "status" | "stage" | "implementation" | "reason">,
): "baseline" | "tdd" | "base-sync" | null {
  const progress = task.implementation;
  if (task.status !== "bloqueada" || !progress) return null;
  if (
    task.reason?.startsWith("Sincronização da base recusada:") ||
    (task.stage === "entrega" && /^PR\/MR .* tem conflitos;/.test(task.reason ?? ""))
  )
    return "base-sync";
  if ((task.stage === "implementacao" || task.stage === "review") && task.reason?.startsWith("TDD recusado "))
    return "tdd";
  if (
    task.stage === "implementacao" &&
    progress.commits.length === 0 &&
    ((progress.baseline === "vermelha" && task.reason === baselineBlockedReason(progress.branch)) ||
      (progress.baseline === null && task.reason === baselineWorkspaceBlockedReason(progress.branch)))
  )
    return "baseline";
  return null;
}
