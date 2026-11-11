// Conversão de texto da fábrica para ADF (Atlassian Document Format) e de volta. Pura: sem rede, sem binário.

/**
 * Trechos de uma linha em ADF: `[~accountid:ID]` vira nó de menção, para o Jira avisar a pessoa (ADR-0020); o resto é
 * texto.
 */
function inlineAdf(line: string): object[] {
  const out: object[] = [];
  let resto = line;
  const mencao = /\[~accountid:([^\]\s]+)\]/;
  for (let m = mencao.exec(resto); m; m = mencao.exec(resto)) {
    if (m.index > 0) out.push({ type: "text", text: resto.slice(0, m.index) });
    out.push({ type: "mention", attrs: { id: m[1] } });
    resto = resto.slice(m.index + m[0].length);
  }
  if (resto) out.push({ type: "text", text: resto });
  return out;
}

/**
 * Texto da fábrica em ADF: linha em branco separa parágrafos, quebra simples vira `hardBreak` e um parágrafo inteiro
 * entre asteriscos (a marca de automação) sai em itálico.
 */
export function textToAdf(text: string): object {
  const paragraphs = text
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p !== "")
    .map((p) => {
      const italic = /^\*([^*\n]+)\*$/.exec(p);
      if (italic) return { type: "paragraph", content: [{ type: "text", text: italic[1], marks: [{ type: "em" }] }] };
      const content = p.split("\n").flatMap((line, i) => {
        const parts: object[] = i > 0 ? [{ type: "hardBreak" }] : [];
        return line ? [...parts, ...inlineAdf(line)] : parts;
      });
      return { type: "paragraph", content };
    });
  return { type: "doc", version: 1, content: paragraphs };
}

/** Nós ADF que terminam numa quebra de linha. */
const BLOCK_TYPES = new Set(["paragraph", "heading", "codeBlock", "listItem", "blockquote"]);

/**
 * Converte documento no formato Atlassian Document Format (ADF) ou string para texto plano legível.
 */
export function adfToText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";

  const n = node as {
    type?: string;
    text?: string;
    content?: unknown[];
    attrs?: { text?: string; id?: string };
    marks?: { type?: string }[];
  };

  if (typeof n.text === "string") return n.marks?.some((m) => m.type === "em") ? `*${n.text}*` : n.text;
  if (n.type === "hardBreak" || n.type === "rule") return "\n";
  if (n.type === "mention") return n.attrs?.text ?? (n.attrs?.id ? `[~accountid:${n.attrs.id}]` : "");

  const inner = Array.isArray(n.content) ? n.content.map(adfToText).join("") : "";
  if (!BLOCK_TYPES.has(n.type ?? "")) return inner;
  return inner.endsWith("\n") ? inner : `${inner}\n`;
}
