import type { RetroIssue } from "./retro-sink.js";

// Similaridade entre títulos de issues da retrô: o que decide se uma proposta já tem issue aberta parecida.

/** Semelhança mínima (Jaccard dos tokens do título) para uma issue aberta contar como "parecida". */
export const SIMILARITY_THRESHOLD = 0.6;

const STOPWORDS = new Set(
  "a o as os e ou de da do das dos em na no nas nos para pra por com sem um uma uns umas que ao aos se the of to in on and for"
    .split(" ")
    .filter(Boolean),
);

/** Tokens do título: minúsculas, sem acentos, sem pontuação, sem palavras vazias e sem tokens de uma letra. */
const tokens = (title: string) =>
  new Set(
    title
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
  );

/** Similaridade de Jaccard entre os tokens de dois títulos (0 a 1). */
export function titleSimilarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  const shared = [...x].filter((t) => y.has(t)).length;
  return shared / (x.size + y.size - shared);
}

/** A issue aberta mais parecida com `title`, acima do limiar; no empate, a mais antiga (menor número). */
export function findSimilarIssue(issues: RetroIssue[], title: string): RetroIssue | undefined {
  let best: { issue: RetroIssue; score: number } | undefined;
  for (const issue of [...issues].sort((a, b) => a.number - b.number)) {
    const score = titleSimilarity(issue.title, title);
    if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) best = { issue, score };
  }
  return best?.issue;
}
