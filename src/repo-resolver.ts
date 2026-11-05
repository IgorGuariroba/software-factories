import type { RepoMapping } from "./config.js";

/** O que a resolução usa do card. */
export interface CardForRepoResolution {
  key: string;
  title: string;
  board?: string;
}

/**
 * O primeiro mapeamento que corresponde ao card: pelo board, pelo prefixo do título ou pelo prefixo da chave.
 * Sem correspondência, `undefined`: a fábrica não adivinha o repositório.
 */
export function resolveRepository(
  repositories: readonly RepoMapping[] | undefined,
  card: CardForRepoResolution,
): RepoMapping | undefined {
  return repositories?.find(
    (m) =>
      (m.board !== undefined && m.board === card.board) ||
      (m.prefix !== undefined && (card.title.startsWith(m.prefix) || card.key.startsWith(m.prefix))),
  );
}
