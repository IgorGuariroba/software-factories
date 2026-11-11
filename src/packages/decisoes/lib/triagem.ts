import { withAutomationMark } from "../../../marca-automacao.js";
import { reviewRevision } from "../../../question-review.js";
import { redactSecrets } from "../../../secrets.js";
import { refusalComment } from "../../../triage.js";
import { DRY_RUN, motivoDeFechamento, partesDoId, projetoDe, referenciaDuplicata } from "./comum.js";
import type { PortasDecisoes, RespostaDecisao } from "./portas.js";

/** Triagem: prévia da decisão (GET) e decisão (POST). */
export async function triagem(
  portas: PortasDecisoes,
  id: string,
  decidir: boolean,
  corpo: unknown,
): Promise<RespostaDecisao> {
  const { projectName, cardKey } = partesDoId(id);
  const task = (await portas.estado()).tasks.find((t) => t.id === id);
  if (!task?.triage) return { status: 404, body: { error: "triagem não encontrada" } };
  if (task.triage.review !== "draft" || task.status !== "aguardando-humano")
    return { status: 409, body: { error: "triagem não está aguardando decisão" } };
  const projeto = projetoDe(portas, projectName);
  const { result } = task.triage;
  const preview = {
    card: cardKey,
    verdict: result.verdict,
    category: result.category,
    reason: result.reason,
    by: result.by,
    duplicateOf: result.duplicateOf ?? null,
    // O que sai na issue se o usuário recusar: o comentário exato e o motivo do fechamento.
    comment: withAutomationMark(redactSecrets(refusalComment(result, referenciaDuplicata(result)))),
    closeAs: motivoDeFechamento(result),
    dryRun: projeto.dryRun,
  };
  const revision = reviewRevision(preview);
  if (!decidir) return { status: 200, body: { ...preview, revision } };
  const dados = corpo as { revision?: unknown; decision?: unknown } | undefined;
  if (dados?.decision !== "aceitar" && dados?.decision !== "recusar")
    return { status: 400, body: { error: 'decision deve ser "aceitar" ou "recusar"' } };
  if (dados.revision !== revision) return { status: 409, body: { error: "prévia alterada; revise novamente" } };
  if (projeto.dryRun && dados.decision === "recusar") return DRY_RUN;
  const decision = dados.decision;
  const decidida = await portas.alterar((estado) => {
    const current = estado.tasks.find((t) => t.id === id);
    if (current?.status !== "aguardando-humano" || current.triage?.review !== "draft") return false;
    current.triage.review = decision;
    current.status = current.pauseRequested ? "pausada" : "enfileirada";
    return true;
  });
  return decidida
    ? { status: 200, body: { ok: true } }
    : { status: 409, body: { error: "triagem mudou ou foi cancelada" } };
}
