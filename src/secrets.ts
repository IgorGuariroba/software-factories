const MASK = "[segredo removido]";

/** Padrões de segredos conhecidos, inspirados nas regras do gitleaks. */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g, // GitLab
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g, // OpenAI, Anthropic
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, // Telegram bot token
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
];

/** `CHAVE=valor`, `chave: "valor"` ou `"chave": "valor"` (JSON) em que o nome da chave indica um segredo. */
const SECRET_ASSIGNMENT =
  /\b([A-Za-z0-9_]*(?:password|passwd|pwd|senha|secret|token|api[_-]?key|access[_-]?key)[A-Za-z0-9_]*)(["']?\s*[:=]\s*)(["']?)([^\s"']+)\3/gi;

/** Mascara segredos em qualquer texto que sai da fábrica. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, MASK);
  return out.replace(SECRET_ASSIGNMENT, (_m, key, sep, quote) => `${key}${sep}${quote}${MASK}${quote}`);
}
