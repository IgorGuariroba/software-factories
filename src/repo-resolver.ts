import type { RepoMapping } from "./config.js";

/** O que a resolução usa do card. */
export interface CardForRepoResolution {
  key: string;
  title: string;
}

/**
 * O primeiro mapeamento que corresponde ao prefixo do título ou da chave do card.
 * Sem correspondência, `undefined`: a fábrica não adivinha o repositório.
 */
export function resolveRepository(
  repositories: readonly RepoMapping[] | undefined,
  card: CardForRepoResolution,
): RepoMapping | undefined {
  return repositories?.find((m) => card.title.startsWith(m.prefix) || card.key.startsWith(m.prefix));
}
