import type { ConventionsConfig } from "./config.js";
import { gitMaybe } from "./git.js";

/** Convenções vistas no histórico. Marcadores: `{key}`, `{slug}` (branch) e `{type}`, `{summary}`, `{key}` (commit). */
export interface RepoConventions {
  branch?: string;
  commit?: string;
}

export interface ResolvedConventions {
  branch: string;
  commit: string;
}

/** Transforma um título em slug seguro para nome de branch. */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Saída do git, ou vazio se falhar (ex.: repositório sem nenhum commit). */
const gitOutput = async (repoPath: string, args: string[]) => (await gitMaybe(repoPath, args))?.trim() ?? "";

/** Descobre convenções de branch e commit inspecionando o histórico recente do repositório local. */
export async function discoverGitConventions(repoPath: string): Promise<RepoConventions> {
  const branchOutput = await gitOutput(repoPath, ["branch", "-a", "--format=%(refname:short)"]);
  const branches = branchOutput
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);

  let featureCount = 0;
  let featCount = 0;
  let ticketCount = 0;

  for (const b of branches) {
    const name = b.replace(/^origin\//, "");
    if (name === "main" || name === "master" || name === "develop") continue;
    if (name.startsWith("feature/")) featureCount++;
    else if (name.startsWith("feat/")) featCount++;
    else if (name.startsWith("ticket/")) ticketCount++;
  }

  let branchPattern = "feature/{key}-{slug}";
  if (featCount > featureCount && featCount >= ticketCount) {
    branchPattern = "feat/{key}-{slug}";
  } else if (ticketCount > featureCount && ticketCount > featCount) {
    branchPattern = "ticket/{key}-{slug}";
  }

  const logOutput = await gitOutput(repoPath, ["log", "-n", "50", "--format=%s"]);
  const commits = logOutput
    .split("\n")
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith("Merge "));

  let suffixKeyCount = 0; // feat: ... (KEY)
  let scopeKeyCount = 0; // feat(KEY): ...
  let prefixBracketKeyCount = 0; // [KEY] feat: ...
  let conventionalCount = 0; // feat: ...

  const suffixKeyRegex = /^(feat|fix|test|refactor|chore|docs|style|perf)(\([^)]+\))?:\s*.+\s+\([A-Z0-9]+-\d+\)$/;
  const scopeKeyRegex = /^(feat|fix|test|refactor|chore|docs|style|perf)\([A-Z0-9]+-\d+\):\s*.+$/;
  const prefixBracketKeyRegex = /^\[[A-Z0-9]+-\d+\]\s*(feat|fix|test|refactor|chore|docs|style|perf):\s*.+$/;
  const conventionalRegex = /^(feat|fix|test|refactor|chore|docs|style|perf)(\([^)]+\))?:\s*.+$/;

  for (const msg of commits) {
    if (suffixKeyRegex.test(msg)) {
      suffixKeyCount++;
    } else if (scopeKeyRegex.test(msg)) {
      scopeKeyCount++;
    } else if (prefixBracketKeyRegex.test(msg)) {
      prefixBracketKeyCount++;
    } else if (conventionalRegex.test(msg)) {
      conventionalCount++;
    }
  }

  let commitPattern = "{type}: {summary}";
  if (suffixKeyCount >= scopeKeyCount && suffixKeyCount >= prefixBracketKeyCount && suffixKeyCount > 0) {
    commitPattern = "{type}: {summary} ({key})";
  } else if (scopeKeyCount > suffixKeyCount && scopeKeyCount >= prefixBracketKeyCount && scopeKeyCount > 0) {
    commitPattern = "{type}({key}): {summary}";
  } else if (prefixBracketKeyCount > 0 && prefixBracketKeyCount >= suffixKeyCount) {
    commitPattern = "[{key}] {type}: {summary}";
  } else if (conventionalCount > 0) {
    commitPattern = "{type}: {summary}";
  }

  return { branch: branchPattern, commit: commitPattern };
}

/** Combina as convenções descobertas com as sobrescritas da config. */
export function resolveConventions(discovered: RepoConventions, overrides?: ConventionsConfig): ResolvedConventions {
  return {
    branch: overrides?.branch ?? discovered.branch ?? "feature/{key}-{slug}",
    commit: overrides?.commit ?? discovered.commit ?? "{type}: {summary}",
  };
}

/** Formata o nome da branch com base na convenção resolvida e nos dados do card. */
export function formatBranchName(conventions: ResolvedConventions, card: { key: string; title: string }): string {
  const slug = slugify(card.title);
  return conventions.branch.replaceAll("{key}", card.key).replaceAll("{slug}", slug);
}

/** Formata a mensagem de commit com base na convenção resolvida. */
export function formatCommitMessage(
  conventions: Pick<ResolvedConventions, "commit">,
  opts: { type: "test" | "feat" | "fix" | "chore"; summary: string; key: string },
): string {
  // Uma linha só: o título do ticket vem do modelo e não pode quebrar a mensagem em várias.
  const summary = opts.summary.replace(/\s+/g, " ").trim();
  return conventions.commit
    .replaceAll("{type}", opts.type)
    .replaceAll("{summary}", summary)
    .replaceAll("{key}", opts.key);
}
