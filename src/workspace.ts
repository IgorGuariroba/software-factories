import { mkdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, matchesGlob, relative, resolve, sep } from "node:path";
import { git, gitMaybe } from "./git.js";

/** Um caminho pedido pelo modelo que cai fora do clone ou dentro de `.git`. */
export class PathRefused extends Error {
  override name = "PathRefused";
}

/** Nome seguro para um componente de caminho (projeto, chave do card). */
const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_") || "_";

/** Onde fica o clone da fábrica para um card: `<raiz>/<projeto>/<card>`. */
export const worktreePathFor = (root: string, project: string, key: string) =>
  join(root, safeName(project), safeName(key));

/** `child` está dentro de `parent` (ou é ele), comparando caminhos já resolvidos. */
function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

const touchesGit = (rel: string) => rel.split(sep).some((part) => part.toLowerCase() === ".git");

/**
 * Resolve um caminho pedido pelo modelo dentro do clone, ou recusa: absoluto, fora do clone (inclusive por symlink),
 * a própria raiz ou qualquer coisa sob `.git` (hooks e config de lá executam código).
 */
export async function confine(root: string, requested: string): Promise<string> {
  if (!requested || requested.includes("\0")) throw new PathRefused("caminho vazio ou inválido");
  if (isAbsolute(requested)) throw new PathRefused(`"${requested}" é absoluto; use um caminho relativo ao repositório`);
  const realRoot = await realpath(root);
  const target = resolve(realRoot, requested);
  const rel = relative(realRoot, target);
  if (rel === "" || !inside(realRoot, target)) throw new PathRefused(`"${requested}" está fora do repositório`);
  if (touchesGit(rel)) throw new PathRefused(`"${requested}" está dentro de .git`);
  // O que já existe no caminho (o alvo ou o ancestral mais próximo) não pode levar para fora por symlink.
  for (let probe = target; ; probe = dirname(probe)) {
    let real: string;
    try {
      real = await realpath(probe);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" && probe !== realRoot) continue;
      throw err;
    }
    if (!inside(realRoot, real)) throw new PathRefused(`"${requested}" sai do repositório por um link simbólico`);
    if (touchesGit(relative(realRoot, real))) throw new PathRefused(`"${requested}" leva a .git por um link simbólico`);
    return target;
  }
}

/** Confere que `worktree` é um clone da fábrica: dentro de `root`, existente. */
export async function assertFactoryWorktree(root: string, worktree: string): Promise<string> {
  const realRoot = await realpath(root);
  const real = await realpath(worktree);
  if (real === realRoot || !inside(realRoot, real)) throw new PathRefused(`${worktree} não é um clone da fábrica`);
  return real;
}

/** Caminhos (relativos, com `/`) mudados no clone em relação ao HEAD, inclusive arquivos novos e apagados. */
export async function changedPaths(worktree: string): Promise<string[]> {
  const out = await git(worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]);
  return out
    .split("\0")
    .filter((entry) => entry.length > 3)
    .map((entry) => entry.slice(3));
}

export const isTestFile = (path: string, patterns: readonly string[]) =>
  patterns.some((pattern) => matchesGlob(path, pattern));

/**
 * Cria o clone da fábrica a partir da cópia do usuário em `repoPath`, sem mexer nela (só leituras): o clone aponta
 * `origin` para o mesmo remoto da cópia, busca o remoto e herda a identidade de commit do usuário.
 * Um clone deixado pela metade (queda no meio) é refeito. Devolve o remoto e a branch padrão dele.
 */
export async function cloneForFactory(repoPath: string, worktree: string): Promise<{ defaultBranch: string }> {
  const remote = (await gitMaybe(repoPath, ["remote", "get-url", "origin"]))?.trim();
  if (!remote) throw new Error(`o repositório ${repoPath} não tem remoto "origin"`);
  const name = (await gitMaybe(repoPath, ["config", "user.name"]))?.trim();
  const email = (await gitMaybe(repoPath, ["config", "user.email"]))?.trim();

  await rm(worktree, { recursive: true, force: true });
  await mkdir(dirname(worktree), { recursive: true });
  await git(dirname(worktree), ["clone", "--quiet", "--no-checkout", "--", repoPath, worktree]);
  await git(worktree, ["remote", "set-url", "origin", remote]);
  await git(worktree, ["fetch", "--quiet", "--prune", "origin"]);
  if (name) await git(worktree, ["config", "user.name", name]);
  if (email) await git(worktree, ["config", "user.email", email]);

  const symref = await gitMaybe(worktree, ["ls-remote", "--symref", "origin", "HEAD"]);
  const defaultBranch = symref?.match(/^ref: refs\/heads\/(\S+)\s+HEAD/m)?.[1];
  if (!defaultBranch) throw new Error(`não foi possível descobrir a branch padrão do remoto de ${repoPath}`);
  return { defaultBranch };
}

/** Cria e entra na branch da fábrica: continua a mesma branch do remoto se ela já existir, senão parte da padrão. */
export async function checkoutFactoryBranch(worktree: string, branch: string, defaultBranch: string): Promise<string> {
  const remoteRef = `refs/remotes/origin/${branch}`;
  const exists = await gitMaybe(worktree, ["rev-parse", "--verify", "--quiet", remoteRef]);
  const start = exists ? remoteRef : `refs/remotes/origin/${defaultBranch}`;
  await git(worktree, ["checkout", "--quiet", "--no-track", "-b", branch, start]);
  return (await git(worktree, ["rev-parse", "HEAD"])).trim();
}

/** Se `branch` é um nome de branch válido para o git. */
export const isValidBranchName = async (worktree: string, branch: string) =>
  (await gitMaybe(worktree, ["check-ref-format", "--branch", branch])) !== undefined;
