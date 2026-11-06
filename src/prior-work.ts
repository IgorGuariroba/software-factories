import { gitMaybe } from "./git.js";

/**
 * Procura, na cópia local do repositório mapeado (só leitura, sem fetch), um commit da branch padrão do remoto que cite
 * a chave do card: sinal de que o card já foi implementado e mergeado. Devolve o commit (sha curto e assunto) ou `null`.
 */
export async function findMergedWork(
  repoPath: string,
  cardKey: string,
): Promise<{ sha: string; subject: string } | null> {
  const head = (await gitMaybe(repoPath, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]))?.trim();
  const candidates = head ? [head] : ["refs/remotes/origin/main", "refs/remotes/origin/master"];
  const key = cardKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const ref of candidates) {
    const found = (
      await gitMaybe(repoPath, ["log", ref, "-1", "-i", "-E", `--grep=${key}([^0-9]|$)`, "--format=%h%x09%s"])
    )?.trim();
    if (found) {
      const [sha = "", subject = ""] = found.split("\t");
      return { sha, subject };
    }
  }
  return null;
}

/**
 * Commit da branch padrão (cópia local, sem fetch) que fecha a issue `n` pelo GitHub ("fixes #n", "closes #n",
 * "resolves #n") ou cita a chave do card. Sinal de trabalho já feito, para a triagem.
 */
export async function findClosingCommit(
  repoPath: string,
  cardKey: string,
  n: number,
): Promise<{ sha: string; subject: string } | null> {
  const byKey = await findMergedWork(repoPath, cardKey);
  if (byKey) return byKey;
  const head = (await gitMaybe(repoPath, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]))?.trim();
  for (const ref of head ? [head] : ["refs/remotes/origin/main", "refs/remotes/origin/master"]) {
    const found = (
      await gitMaybe(repoPath, [
        "log",
        ref,
        "-1",
        "-i",
        "-E",
        `--grep=(close[sd]?|fix(e[sd])?|resolve[sd]?):? #${n}([^0-9]|$)`,
        "--format=%h%x09%s",
      ])
    )?.trim();
    if (found) {
      const [sha = "", subject = ""] = found.split("\t");
      return { sha, subject };
    }
  }
  return null;
}

/** Assuntos dos últimos `limit` commits da branch padrão (cópia local), para a triagem ver o que já foi feito. */
export async function recentSubjects(repoPath: string, limit = 50): Promise<string[]> {
  const head = (await gitMaybe(repoPath, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]))?.trim();
  for (const ref of head ? [head] : ["refs/remotes/origin/main", "refs/remotes/origin/master"]) {
    const out = (await gitMaybe(repoPath, ["log", ref, `-${limit}`, "--format=%h %s"]))?.trim();
    if (out) return out.split("\n");
  }
  return [];
}
