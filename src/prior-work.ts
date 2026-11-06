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
