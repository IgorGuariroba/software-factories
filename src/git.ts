import { execFile } from "node:child_process";

/** Um git que falhou: o código de saída e a saída de erro, para a mensagem da Tarefa. */
export class GitError extends Error {
  override name = "GitError";
  constructor(
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} falhou (${exitCode}): ${stderr.trim().slice(0, 500)}`);
  }
}

/**
 * Roda git em `cwd`, sem shell e sem perguntar credenciais no terminal. Hooks ficam desligados: o conteúdo do
 * repositório vem do modelo, e um hook (do repo ou global) executaria esse conteúdo fora de qualquer controle.
 */
export function git(cwd: string, args: readonly string[]): Promise<string> {
  const full = ["-c", "core.hooksPath=/dev/null", ...args];
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      full,
      { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new GitError(args, typeof err.code === "number" ? err.code : null, String(stderr)));
        else resolve(String(stdout));
      },
    );
  });
}

/** Como `git`, mas devolve `undefined` em vez de lançar (ex.: uma ref que pode não existir). */
export async function gitMaybe(cwd: string, args: readonly string[]): Promise<string | undefined> {
  try {
    return await git(cwd, args);
  } catch (err) {
    if (err instanceof GitError) return undefined;
    throw err;
  }
}
