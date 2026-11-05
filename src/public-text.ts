import { basename } from "node:path";
import type { ProjectConfig } from "./config.js";

/** O que entra no lugar de um valor do projeto removido do texto público. */
export const REMOVED = "[removido]";
const REMOVED_LINK = "[link removido]";
const REMOVED_PATH = "[caminho removido]";

/** Termos com pelo menos isto de letras e dígitos também são procurados com outra grafia (ex.: `_` no lugar de `-`). */
const COMPACT_MIN = 6;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Minúsculas, sem acentos e só letras e dígitos: "Serviço_Pagamentos" e "servico-pagamentos" ficam iguais. */
const compact = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
/** O termo como palavra inteira, sem diferenciar maiúsculas. */
const asWord = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "giu");

/**
 * Valores do projeto que nunca saem para o repositório público da fábrica: nome do projeto, chave do projeto na Fonte,
 * usuário, pessoas (ids e nomes), repositórios mapeados (caminho, nome, prefixo, board) e o que vier em `extra` (ex.:
 * a chave e o título do card da Tarefa).
 */
export function privateTerms(config: ProjectConfig, extra: string[] = []): string[] {
  const terms = [
    config.name,
    config.source.project,
    config.source.assignee,
    ...config.people.flatMap((p) => [p.id, p.name ?? ""]),
    ...(config.repositories ?? []).flatMap((r) => [r.path, basename(r.path), r.prefix ?? "", r.board ?? ""]),
    ...extra,
  ];
  // Os mais longos primeiro: o caminho inteiro sai antes do nome do diretório que ele contém.
  return [...new Set(terms.map((t) => t.trim()).filter((t) => t.length > 0))].sort((a, b) => b.length - a.length);
}

/**
 * Saneamento por código do texto que vai ao repositório público: troca os valores do projeto por `[removido]`, as
 * chaves de card do projeto (`CHAVE-123`), os links e os caminhos absolutos. Depois confere o que sobrou: uma chave de
 * card com outra grafia (`chave_123`) ou um termo longo escrito de outro jeito (outra caixa, acentos, separadores).
 * Se sobrar algo, `leftovers` diz o quê e a escrita deve ser barrada.
 */
export function sanitizePublicText(
  text: string,
  opts: { terms: string[]; cardPrefix: string },
): { text: string; leftovers: string[] } {
  let out = text
    // Todo link sai, inclusive os da própria fábrica: a Tarefa aparece só pelo id opaco. O link termina antes da
    // pontuação que o segue no texto.
    .replace(/\bhttps?:\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]]/gi, REMOVED_LINK)
    .replace(/(?<![\p{L}\p{N}_.~-])(?:~|\.\.?)?\/[\w.-]+(?:\/[\w.-]+)+\/?/gu, REMOVED_PATH);
  const cardKey = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(opts.cardPrefix)}-\\d+(?![\\p{N}])`, "giu");
  out = out.replace(cardKey, REMOVED);
  const leftovers: string[] = [];
  // Antes de trocar os termos: a chave do projeto sozinha sairia, e o `_123` que sobra esconderia a chave do card.
  const otherKey = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(opts.cardPrefix)}[^\\p{L}\\p{N}]*\\d+`, "iu");
  if (otherKey.test(out)) leftovers.push(`chave de card do projeto (${opts.cardPrefix})`);
  for (const term of opts.terms) out = out.replace(asWord(term), REMOVED);

  const compactOut = compact(out);
  for (const term of opts.terms) {
    const c = compact(term);
    if (c.length >= COMPACT_MIN && compactOut.includes(c)) leftovers.push(`"${term}"`);
  }
  return { text: out, leftovers };
}
