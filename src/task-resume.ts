import type { QueuedTask } from "./durable.js";
import { baselineBlockedReason, baselineWorkspaceBlockedReason } from "./implement-stage.js";

/** A mesma elegibilidade serve ao comando e à interface; outros guardrails não são retomáveis. */
export function blockedResumeKind(
  task: Pick<QueuedTask, "status" | "stage" | "implementation" | "reason">,
): "baseline" | "tdd" | null {
  const progress = task.implementation;
  if (task.status !== "bloqueada" || !progress) return null;
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
