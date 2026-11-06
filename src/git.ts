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
 * Variáveis que fazem o git agir em outro repositório (`git rev-parse --local-env-vars`). Um hook do git as exporta;
 * herdadas, o git da fábrica operaria no repositório do hook e não no `cwd` — inclusive dando push no remoto dele.
 * Configuração passada pelo ambiente (`GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`, `GIT_CONFIG_PARAMETERS`, ex.:
 * `safe.directory` na CI) não aponta para outro repositório e é preservada.
 */
const REPO_ENV_VARS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

/** O ambiente do processo sem as variáveis que apontam o git para outro repositório. */
export function gitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  for (const name of REPO_ENV_VARS) delete env[name];
  return env;
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
      { cwd, env: gitEnv({ GIT_TERMINAL_PROMPT: "0" }), maxBuffer: 64 * 1024 * 1024 },
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
