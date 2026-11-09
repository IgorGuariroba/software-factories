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

/** Escolha humana explícita e inequívoca, limitada aos repositórios configurados. */
export function repositoryFromAnswer(
  repositories: readonly RepoMapping[] | undefined,
  answer: string,
): RepoMapping | undefined {
  const choice = answer.trim();
  if (!choice) return undefined;
  const matches = repositories?.filter((mapping) => mapping.path === choice || mapping.prefix === choice) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

/** Pergunta determinística: não usa o modelo, descrição ou ordem de candidatos como palpite. */
export function repositoryQuestion(card: CardForRepoResolution, repositories: readonly RepoMapping[]): string {
  return [
    `Não consegui identificar o repositório do card ${card.key} pelo prefixo ou board/projeto. Qual repositório configurado devo usar?`,
    "Responda com o caminho exato ou um prefixo único da lista abaixo. Se não souber, responda não sei.",
    ...repositories.map((mapping) => `- ${mapping.prefix}: ${mapping.path}`),
  ].join("\n");
}
