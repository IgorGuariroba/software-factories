import type { Card, CardComment, LinkedPullRequest } from "./demand-source.js";
import { isAutomationText } from "./marca-automacao.js";
import { numeroDaChave } from "./packages/fonte-demanda/index.js";

/** Decisão da triagem de uma issue (ADR-0014). */
export type TriageVerdict = "aceita" | "recusa" | "duvidosa";

/** Por que a triagem decidiu assim. */
export type TriageCategory =
  | "ok"
  | "ja-feito"
  | "pr-aberto"
  | "duplicata"
  | "abuso"
  | "seguranca"
  | "resolvida"
  | "escopo"
  | "clareza";

/** Como a issue recusada é fechada no GitHub. */
export type CloseReason = "completed" | "not_planned" | "duplicate";

export type TriageResult = {
  verdict: TriageVerdict;
  category: TriageCategory;
  /** Motivo para o usuário (nunca vai ao card como está). */
  reason: string;
  /** Quem decidiu: as checagens determinísticas ou o modelo. */
  by: "regra" | "modelo";
  /** Chave da issue de que esta é duplicata. */
  duplicateOf?: string;
  /** Como fechar, se recusada. Sem ele, `not_planned` (ou `duplicate`, para duplicata). */
  closeAs?: CloseReason;
};

/** O que a fábrica sabe da issue antes do modelo. */
export type TriageSignals = {
  card: Card;
  /** As outras issues abertas do repositório. */
  others: Card[];
  /** Comentários da issue (os da fábrica são ignorados). */
  comments: CardComment[];
  /** PRs que citam a issue. */
  pullRequests: LinkedPullRequest[];
  /** Commit da branch padrão que cita a issue; `closes`: com verbo de fechamento ("fixes #7"), não só menção. */
  mergedCommit: { sha: string; subject: string; closes: boolean } | null;
};

/** Acima disto (caracteres), o texto da issue é sinal de abuso: não vai ao modelo. */
export const TRIAGE_MAX_CHARS = 40_000;

/** Frases típicas de prompt injection: só sinal para o usuário olhar, não prova. */
const INJECTION =
  /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|all)\b.{0,20}\b(instructions?|prompts?|rules?)\b|\bsystem prompt\b|\bignore (as|todas as) instru|\bvocê agora é\b|\byou are now\b/i;

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const issueNumber = (key: string) => numeroDaChave(key);

/** Se o texto tem frases típicas de prompt injection. */
export const looksLikeInjection = (text: string) => INJECTION.test(text);

/** Comentários de pessoas: os da própria fábrica (automação) não entram na decisão. */
export const comentariosHumanos = <C extends { body: string }>(comentarios: readonly C[]): C[] =>
  comentarios.filter((c) => !isAutomationText(c.body));

/**
 * O contexto que acompanha a issue (as outras issues abertas, os commits recentes) também é dado não confiável: o que
 * tiver frase de injeção fica de fora, nos dois caminhos (classificador e LLM).
 */
export function trustedContext(others: Card[], recentCommits: string[]): { others: Card[]; recentCommits: string[] } {
  return {
    others: others.filter((o) => !looksLikeInjection(`${o.title}\n${o.description ?? ""}`)),
    recentCommits: recentCommits.filter((c) => !looksLikeInjection(c)),
  };
}

/** Checagens determinísticas, antes de qualquer modelo. `undefined`: nada conclusivo, a issue vai ao modelo. */
export function deterministicTriage(s: TriageSignals): TriageResult | undefined {
  const text = `${s.card.title}\n${s.card.description ?? ""}`;
  const comments = comentariosHumanos(s.comments).map((c) => c.body);
  if (text.length > TRIAGE_MAX_CHARS)
    return {
      verdict: "duvidosa",
      category: "abuso",
      by: "regra",
      reason: `texto da issue com ${text.length} caracteres, acima do limite de ${TRIAGE_MAX_CHARS}`,
    };
  if (INJECTION.test(text) || comments.some((c) => INJECTION.test(c)))
    return {
      verdict: "duvidosa",
      category: "abuso",
      by: "regra",
      reason: "o texto da issue tem frases típicas de prompt injection",
    };

  // Só um commit com verbo de fechamento prova a resolução; uma menção (PR ou commit) vai ao usuário.
  if (s.mergedCommit?.closes)
    return {
      verdict: "recusa",
      category: "ja-feito",
      closeAs: "completed",
      by: "regra",
      reason: `o commit ${s.mergedCommit.sha} ("${s.mergedCommit.subject}") da branch padrão fecha esta issue`,
    };
  const merged = s.pullRequests.find((pr) => pr.state === "merged");
  if (merged)
    return {
      verdict: "duvidosa",
      category: "ja-feito",
      by: "regra",
      reason: `o PR #${merged.number}, já mergeado, menciona esta issue: confira se ela já foi resolvida`,
    };
  if (s.mergedCommit)
    return {
      verdict: "duvidosa",
      category: "ja-feito",
      by: "regra",
      reason: `o commit ${s.mergedCommit.sha} ("${s.mergedCommit.subject}") da branch padrão cita esta issue`,
    };
  const open = s.pullRequests.find((pr) => pr.state === "open");
  if (open)
    return {
      verdict: "duvidosa",
      category: "pr-aberto",
      by: "regra",
      reason: `o PR #${open.number}, ainda aberto, cita esta issue: alguém já trabalha nela`,
    };

  const mine = normalize(text);
  const original = s.others
    .filter((o) => o.key !== s.card.key && issueNumber(o.key) < issueNumber(s.card.key))
    .sort((a, b) => issueNumber(a.key) - issueNumber(b.key))
    .find((o) => normalize(`${o.title}\n${o.description ?? ""}`) === mine);
  if (original)
    return {
      verdict: "recusa",
      category: "duplicata",
      closeAs: "duplicate",
      duplicateOf: original.key,
      by: "regra",
      reason: `título e texto iguais aos da issue ${original.key}, mais antiga`,
    };
  return undefined;
}

/**
 * Comentário curto que acompanha a recusa. Nunca expõe a regra de segurança: uma recusa por segurança ou abuso sai com
 * o mesmo texto genérico de fora de escopo.
 */
export function refusalComment(result: TriageResult, duplicateRef?: string): string {
  switch (result.category) {
    case "duplicata":
      return `Fechando como duplicata de ${duplicateRef ?? result.duplicateOf ?? "outra issue"}; a discussão segue lá.`;
    case "ja-feito":
    case "resolvida":
      return "Fechando: isto já está resolvido no código. Se ainda acontecer, reabra com os passos para reproduzir.";
    case "clareza":
      return "Fechando por falta de detalhe para seguir. Reabra com o objetivo, os passos e o resultado esperado.";
    default:
      return "Fechando: está fora do que este repositório planeja fazer agora.";
  }
}

// Limites e sanitização do texto que vai ao modelo: compartilhados pela entrega e pelo classificador.
export const PART_MAX = 20_000;
export const cut = (text: string, max = PART_MAX) => (text.length > max ? `${text.slice(0, max)}\n[…truncado]` : text);

/** Neutraliza `<` e `>` num dado, para nenhum texto abrir ou fechar o bloco `<dados>`. */
export const inert = (text: string) => text.replace(/</g, "‹").replace(/>/g, "›");
