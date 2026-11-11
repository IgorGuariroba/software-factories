// Marca de automação: o que a fábrica escreve leva uma marca no fim, e o que a fábrica já escreveu é reconhecido por
// ela (inclusive os prefixos antigos). Funções puras, sem Fonte nem estado.

/** Marca de automação: vai no fim de todo texto que a fábrica escreve, depois de uma linha em branco. */
export const AUTOMATION_MARK = "*mensagem automatizada*";
const MARK_SUFFIX = `\n\n${AUTOMATION_MARK}`;
/** Prefixos usados antes; reconhecidos para não duplicar nem tratar como humano o que a fábrica já escreveu. */
const LEGACY_PREFIXES = ["\u{1F916} [mensagem automatizada]", "\u{1F916} [fábrica]"];

/** Se o texto foi escrito pela fábrica (marca atual no fim ou prefixo antigo). */
export function isAutomationText(body: string): boolean {
  return body.trimEnd().endsWith(AUTOMATION_MARK) || LEGACY_PREFIXES.some((p) => body.startsWith(p));
}

/** O texto sem a marca de automação (atual ou antiga): o que a fábrica quis dizer. */
export function stripAutomationMark(body: string): string {
  const legacy = LEGACY_PREFIXES.find((p) => body.startsWith(p));
  if (legacy) return body.slice(legacy.length).replace(/^ /, "");
  const trimmed = body.trimEnd();
  return trimmed.endsWith(AUTOMATION_MARK) ? trimmed.slice(0, -AUTOMATION_MARK.length).trimEnd() : body;
}

/**
 * Igualdade de texto que ignora linhas em branco: a Fonte pode devolver parágrafos sem a linha em branco que a fábrica
 * escreveu (o ADF do Jira separa blocos por quebra simples), e a deduplicação não pode repetir o comentário por isso.
 */
export function mesmoTexto(a: string, b: string): boolean {
  const semVazias = (t: string) =>
    t
      .split("\n")
      .filter((l) => l.trim() !== "")
      .join("\n");
  return semVazias(a) === semVazias(b);
}

/** O texto com a marca de automação no fim. */
export function withAutomationMark(body: string): string {
  return `${body}${MARK_SUFFIX}`;
}

/** Uma escrita recusada por guardrail. Nunca chega à Fonte. */
export class GuardrailViolation extends Error {
  override name = "GuardrailViolation";
}
