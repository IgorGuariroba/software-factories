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

const SECRET_KEY = String.raw`\b([A-Za-z0-9_]*(?:password|passwd|pwd|senha|secret|token|api[_-]?key|access[_-]?key)[A-Za-z0-9_]*)`;
const QUOTED = String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'`;
/**
 * Uma palavra de valor YAML sem aspas. `)` e `]` podem aparecer no meio, mas não no fim: ali fecham o parêntese ou o
 * colchete em volta da atribuição (`(api_key: x)`), e ficam fora do valor mascarado.
 */
const VALUE_WORD = String.raw`[^\s"',;}]*[^\s"',;})\]]`;
/** Uma palavra que começa outra atribuição (`chave:` ou `chave=`) encerra o valor anterior. */
const WORD = String.raw`(?![A-Za-z0-9_-]+["']?\s*[:=])${VALUE_WORD}`;

/**
 * Atribuições em que o nome da chave indica um segredo:
 * - `chave: valor` (YAML): o valor sem aspas pode ter espaços e vai até o fim da linha, até a próxima atribuição ou
 *   até a pontuação que fecha o trecho em volta (`)`, `]`, `}`, `,`);
 * - `CHAVE=valor` (env): o valor sem aspas vai até o próximo espaço;
 * - em ambos, e em JSON (`"chave": "valor"`), valores entre aspas podem ter espaços e aspas escapadas.
 */
const SECRET_ASSIGNMENTS = [
  new RegExp(String.raw`${SECRET_KEY}(["']?[ \t]*:[ \t]*)(?:${QUOTED}|${VALUE_WORD}(?:[ \t]+${WORD})*)`, "gi"),
  new RegExp(String.raw`${SECRET_KEY}(["']?\s*=\s*)(?:${QUOTED}|[^\s"']+)`, "gi"),
];

/** Mascara segredos em qualquer texto que sai da fábrica. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, MASK);
  for (const pattern of SECRET_ASSIGNMENTS) {
    out = out.replace(pattern, (match, key: string, sep: string) => {
      const value = match.slice(key.length + sep.length);
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : "";
      return `${key}${sep}${quote}${MASK}${quote}`;
    });
  }
  return out;
}
