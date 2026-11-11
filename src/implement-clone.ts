import { rm } from "node:fs/promises";
import { join } from "node:path";
import { git } from "./git.js";

// Operações git sobre o clone da implementação: descarte de alterações, commit de caminhos verificados e leitura dos
// fatos que a regra de formatação e a de escopo usam. A decisão (o que aceitar) fica nos pacotes; aqui só há git.

/** Devolve os caminhos ao estado do último commit: os que existem nele são restaurados, os novos são apagados. */
export async function descartarCaminhos(worktree: string, paths: string[]): Promise<void> {
  const tracked = (await git(worktree, ["--literal-pathspecs", "ls-tree", "-z", "--name-only", "HEAD", "--", ...paths]))
    .split("\0")
    .filter(Boolean);
  if (tracked.length > 0) await git(worktree, ["--literal-pathspecs", "checkout", "HEAD", "--", ...tracked]);
  for (const path of paths.filter((p) => !tracked.includes(p))) await rm(join(worktree, path), { force: true });
}

/** Commita exatamente os caminhos informados, com a mensagem dada. Devolve o SHA do novo HEAD. */
export async function commitarCaminhos(worktree: string, paths: string[], message: string): Promise<string> {
  await git(worktree, ["--literal-pathspecs", "add", "-A", "--", ...paths]);
  await git(worktree, ["commit", "--quiet", "-m", message]);
  return (await git(worktree, ["rev-parse", "HEAD"])).trim();
}

/** Fatos do intervalo entre o commit RED e o HEAD: assuntos, caminhos e diff ignorando espaços. */
export async function fatosDoRed(
  worktree: string,
  red: string,
  head: string,
): Promise<{ assuntos: string[]; caminhos: string[]; diffSemEspacos: string }> {
  const assuntos = (await git(worktree, ["log", "--format=%s", `${red}..${head}`])).trim().split("\n");
  const caminhos = (await git(worktree, ["diff", "--name-only", "-z", red, head])).split("\0").filter(Boolean);
  const diffSemEspacos = await git(worktree, ["diff", "--ignore-all-space", "--format=", red, head, "--", ...caminhos]);
  return { assuntos, caminhos, diffSemEspacos };
}

/** Caminhos que o intervalo `base..HEAD` já tocou. */
export async function caminhosTocadosDesde(worktree: string, base: string): Promise<Set<string>> {
  return new Set((await git(worktree, ["diff", "--name-only", "-z", base, "HEAD"])).split("\0").filter(Boolean));
}
