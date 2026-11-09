import type { QueuedTask } from "./durable.js";
import type { FactoryEvent } from "./events.js";

/** Uma Tarefa como a API a lista em `GET /tasks`. */
export const taskSummary = ({
  id,
  project,
  key,
  title,
  status,
  stage,
  attempts,
  reason,
  ref,
  specReview,
  triage,
  questions,
}: QueuedTask) => ({
  id,
  /** Identificador opaco da Tarefa: o único que sai no link das issues públicas da fábrica. */
  ref: ref ?? null,
  project,
  key,
  title,
  status,
  stage: stage ?? null,
  attempts,
  reason,
  /** O que o quadro precisa para dizer a ação pendente sem abrir o detalhe. */
  specReview: specReview ?? null,
  triageReview: triage?.review ?? null,
  /** Só a que já pode ser respondida: rascunho ou envio não confirmado não têm resposta ainda. */
  pendingQuestion:
    questions?.find((q) => q.answer === null && q.publication !== "draft" && q.publication !== "sending")?.n ?? null,
});

/**
 * Eventos de uma Tarefa: as mudanças de status dela e o que a fábrica fez no card (comentários, edições, transições,
 * perguntas, avisos) ou na branch da Tarefa (push).
 */
export function taskEvents(task: QueuedTask, events: FactoryEvent[]): FactoryEvent[] {
  const branch = task.implementation?.branch;
  return events.filter((e) => {
    if (e.type === "task") return e.id === task.id;
    if (!("project" in e) || e.project !== task.project) return false;
    return (
      e.target === task.key || e.target.startsWith(`${task.key}#`) || (branch !== undefined && e.target === branch)
    );
  });
}

/** O detalhe de uma Tarefa em `GET /tasks/{projeto}/{card}`: estado, etapa, perguntas, SPEC, histórico e escritas. */
export function taskDetail(task: QueuedTask, events: FactoryEvent[]) {
  const history = taskEvents(task, events);
  const implementation = task.implementation;
  return {
    ...taskSummary(task),
    pauseRequested: task.pauseRequested,
    vetoUntil: task.status === "aguardando-veto" && task.veto ? new Date(task.veto.until).toISOString() : null,
questions: (task.questions ?? []).map(({ n, to, text, askedAt, answer, teamsNotice, publication, reminder, origin, userResponse, needsForwarding }) => ({
      n, to, text, askedAt: new Date(askedAt).toISOString(), answer, origin,
      userResponse: userResponse ?? null, needsForwarding: needsForwarding ?? false,
      teamsNotice: teamsNotice?.status ?? null, publication: publication ?? "sent", reminder: reminder ?? null,
    })),
    review: task.review ? { head: task.review.head, status: task.review.status, summary: task.review.summary } : null,
    publication: task.publication ?? null,
    spec: task.delivery?.spec ?? null,
    specReview: task.specReview ?? null,
    triage: task.triage
      ? { verdict: task.triage.result.verdict, reason: task.triage.result.reason, review: task.triage.review }
      : null,
    tickets: task.delivery?.tickets ?? [],
    implementation: implementation
      ? {
          branch: implementation.branch,
          branchOrigin: implementation.branchOrigin ?? null,
          repairs: implementation.repairs ?? [],
          commits: implementation.commits,
          pushed: implementation.pushed,
          baseline: implementation.baseline ?? null,
          baselineDiagnostic: implementation.baselineDiagnostic ?? null,
          environmentRecovery: implementation.environmentRecovery ?? null,
        }
      : null,
    /** Retrôs das etapas e a consolidada, com as propostas classificadas e o que virou cada uma. */
    retros: (task.retros ?? []).map(({ stage, status, attempts, error, summary, proposals }) => ({
      stage,
      status,
      attempts,
      error,
      summary,
      proposals: (proposals ?? []).map(({ n, kind, title, description, status, issue, reason }) => ({
        n,
        kind,
        title,
        description,
        status,
        issue,
        reason,
      })),
    })),
    events: history,
    /** Escritas feitas, registradas no dry-run ou barradas por um guardrail. */
    writes: history.filter((e) => e.type === "write" || e.type === "blocked"),
  };
}
