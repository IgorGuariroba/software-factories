import { createHash } from "node:crypto";
import type { ProjectConfig } from "./config.js";
import type { RetroProposal, RetroStage } from "./durable.js";
import type { EffectWriter } from "./effect-writer.js";
import { GuardrailViolation, withAutomationMark } from "./marca-automacao.js";
import { findSimilarIssue } from "./retro-similaridade.js";
import type { RetroIssue, RetroSink } from "./retro-sink.js";

// Publicação das propostas de retrô da fábrica: a prévia revisável e a escrita pública (issue nova, +1 numa parecida).

export type FactoryRetroPublication = {
  writer: EffectWriter;
  cardKey: string;
  config: ProjectConfig;
  sink?: RetroSink;
  repo?: string;
  stage: RetroStage;
  ref: string;
  proposal: RetroProposal;
};

/** Prepara exatamente o texto a ser revisado antes da escrita pública. */
export async function previewFactoryRetro(opts: FactoryRetroPublication) {
  const { writer, cardKey, stage, ref, proposal } = opts;
  const taskMarker = `tarefa \`${ref}\``;
  const origin = `Origem: ${taskMarker}, retrô ${stage}, proposta ${proposal.n}.`;
  const [titleResult, bodyResult, safeOrigin, safeTaskMarker] = await Promise.all([
    writer.publicRetroPreview(cardKey, proposal.title.slice(0, 200)),
    writer.publicRetroPreview(cardKey, `${proposal.description}\n\n---\n${origin}`),
    writer.publicRetroText(cardKey, origin),
    writer.publicRetroText(cardKey, taskMarker),
  ]);
  const title = titleResult.text;
  const issueBody = bodyResult.text;
  const blocked = titleResult.leftovers.length > 0 || bodyResult.leftovers.length > 0;
  const body = withAutomationMark(issueBody);
  const revision = createHash("sha256")
    .update(JSON.stringify([opts.repo, title, body, opts.config.dryRun, blocked]))
    .digest("hex");
  return { title, body, revision, issueBody, safeOrigin, safeTaskMarker, blocked };
}

/** Publica somente uma proposta já revisada; a seleção de issue semelhante não acrescenta texto privado. */
export async function publishFactoryRetro(
  opts: FactoryRetroPublication,
  preview: Awaited<ReturnType<typeof previewFactoryRetro>>,
): Promise<void> {
  const { proposal } = opts;
  const { sink, repo, config, writer, cardKey } = opts;
  if (!sink || !repo) {
    proposal.status = "sem-repo";
    return;
  }
  const mentions = (issue: RetroIssue, marker: string) =>
    issue.body.includes(marker) || issue.comments.some((c) => c.includes(marker));

  const { safeOrigin, safeTaskMarker, title: safeTitle, issueBody } = preview;
  const open = await sink.listOpen(repo);
  // Já publicada numa tentativa anterior (ex.: a fábrica caiu logo depois de escrever).
  const published = open.find((i) => mentions(i, safeOrigin));
  if (published) {
    proposal.status = published.body.includes(safeOrigin) ? "issue-criada" : "mais-um";
    proposal.issue = { number: published.number, url: published.url };
    return;
  }
  const similar = findSimilarIssue(open, safeTitle);
  try {
    // Uma Tarefa conta uma vez por issue: a consolidada que repete uma proposta da etapa não comenta de novo.
    if (similar && mentions(similar, safeTaskMarker)) {
      proposal.status = "ja-registrada";
      proposal.issue = { number: similar.number, url: similar.url };
    } else if (similar) {
      await writer.commentRetroIssue(cardKey, repo, similar.number, `+1\n\n${safeOrigin}`);
      proposal.status = config.dryRun ? "dry-run" : "mais-um";
      proposal.issue = { number: similar.number, url: similar.url };
    } else {
      const created = await writer.openRetroIssue(cardKey, repo, {
        // O GitHub aceita títulos de até 256 caracteres.
        title: preview.title,
        body: issueBody,
      });
      proposal.status = created ? "issue-criada" : "dry-run";
      proposal.issue = created ?? null;
    }
  } catch (err) {
    // Barrada pelo guardrail (o evento já saiu): a proposta fica registrada e a retrô segue com as outras.
    if (!(err instanceof GuardrailViolation)) throw err;
    proposal.status = "bloqueada";
    proposal.reason = err.message;
  }
}
