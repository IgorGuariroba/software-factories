import { withAutomationMark } from "../../../marca-automacao.js";
import { reviewRevision } from "../../../question-review.js";
import { redactSecrets } from "../../../secrets.js";
import { renderTickets } from "../../../spec-stage.js";
import { partesDoId, projetoDe, SEM_REVISAO } from "./comum.js";
import type { PortasDecisoes, RespostaDecisao } from "./portas.js";

/** SPEC: prévia (GET) e aprovação local (POST). */
export async function spec(
  portas: PortasDecisoes,
  id: string,
  aprovar: boolean,
  corpo: unknown,
): Promise<RespostaDecisao> {
  const { projectName, cardKey } = partesDoId(id);
  const task = (await portas.estado()).tasks.find((t) => t.id === id);
  if (!task?.delivery) return { status: 404, body: { error: "SPEC não encontrada" } };
  if (task.specReview !== "draft" || task.status !== "aguardando-humano")
    return { status: 409, body: { error: "SPEC não está disponível para aprovação" } };
  const projeto = projetoDe(portas, projectName);
  const preview = {
    card: cardKey,
    spec: withAutomationMark(redactSecrets(`SPEC\n\n${task.delivery.spec}`)),
    tickets: withAutomationMark(redactSecrets(`Tickets\n\n${renderTickets(task.delivery.tickets)}`)),
    dryRun: projeto.dryRun,
  };
  const revision = reviewRevision(preview);
  if (!aprovar) return { status: 200, body: { ...preview, revision } };
  const dados = corpo as { revision?: unknown } | undefined;
  if (dados?.revision !== revision) return SEM_REVISAO;
  // Aprovação é local; o escritor continua responsável por suprimir efeitos no dry-run.
  const aprovada = await portas.alterar((estado) => {
    const current = estado.tasks.find((t) => t.id === id);
    if (current?.status !== "aguardando-humano" || current.specReview !== "draft") return false;
    current.specReview = "approved";
    current.specApprovedDryRun = projeto.dryRun;
    current.status = current.pauseRequested ? "pausada" : "enfileirada";
    return true;
  });
  return aprovada
    ? { status: 200, body: { ok: true } }
    : { status: 409, body: { error: "SPEC mudou ou foi cancelada" } };
}
