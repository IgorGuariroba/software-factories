import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const pexec = promisify(execFile);

/** git de verdade, sem hooks globais da máquina que roda os testes. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await pexec("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd });
  return stdout.trim();
}

/** Um remoto bare e a cópia de trabalho do usuário clonada dele, com um commit inicial em `main`. */
export interface RemoteRepo {
  /** O remoto (o papel do GitLab). */
  bare: string;
  /** A cópia de trabalho do usuário, que é o caminho mapeado na config. */
  user: string;
  /** Commits de uma branch do remoto, do mais antigo ao mais novo (só os que não estão em `main`). */
  branchLog(branch: string): Promise<{ subject: string; files: string[] }[]>;
  branches(): Promise<string[]>;
  /** Conteúdo de um arquivo numa branch do remoto. */
  show(branch: string, path: string): Promise<string>;
  /** Estado observável da cópia do usuário: HEAD, branch, status e branches locais. */
  userSnapshot(): Promise<string>;
}

export async function createRemoteRepo(
  root: string,
  name: string,
  opts: { files?: Record<string, string>; commits?: string[]; branches?: string[] } = {},
): Promise<RemoteRepo> {
  const bare = join(root, `${name}.git`);
  const user = join(root, name);
  await pexec("git", ["init", "--quiet", "--bare", "-b", "main", bare]);
  await pexec("git", ["clone", "--quiet", bare, user]);
  await git(user, "config", "user.name", "Pessoa Teste");
  await git(user, "config", "user.email", "pessoa@exemplo.test");
  for (const [path, content] of Object.entries(opts.files ?? {})) {
    await mkdir(dirname(join(user, path)), { recursive: true });
    await writeFile(join(user, path), content);
  }
  await git(user, "add", "-A");
  await git(user, "commit", "--quiet", "--allow-empty", "-m", "chore: setup inicial");
  for (const message of opts.commits ?? []) await git(user, "commit", "--quiet", "--allow-empty", "-m", message);
  await git(user, "push", "--quiet", "origin", "main");
  for (const branch of opts.branches ?? []) await git(user, "push", "--quiet", "origin", `main:refs/heads/${branch}`);

  return {
    bare,
    user,
    async branchLog(branch) {
      const shas = (await git(bare, "rev-list", "--reverse", `main..${branch}`)).split("\n").filter(Boolean);
      return Promise.all(
        shas.map(async (sha) => ({
          subject: await git(bare, "log", "-1", "--format=%s", sha),
          files: (await git(bare, "show", "--name-only", "--format=", sha)).split("\n").filter(Boolean),
        })),
      );
    },
    async branches() {
      return (await git(bare, "branch", "--format=%(refname:short)")).split("\n").filter(Boolean);
    },
    show: (branch, path) => git(bare, "show", `${branch}:${path}`),
    async userSnapshot() {
      return [
        await git(user, "rev-parse", "HEAD"),
        await git(user, "branch", "--show-current"),
        await git(user, "status", "--porcelain", "--untracked-files=all"),
        await git(user, "branch", "--list", "--format=%(refname:short)"),
      ].join("\n---\n");
    },
  };
}

/** Diretório temporário para os repositórios de um teste. */
export const tempRoot = () => mkdtemp(join(tmpdir(), "fabrica-repos-"));
export const removeTempRoot = (dir: string) => rm(dir, { recursive: true, force: true });
