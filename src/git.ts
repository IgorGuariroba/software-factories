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
 */
const REPO_ENV_VARS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
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

/**
 * Da configuração passada pelo ambiente só passa o que não redireciona o git: `safe.directory` (ex.: na CI).
 * `core.worktree`, `remote.*.pushurl`, `url.*.insteadOf` e afins mandariam leitura ou push para outro lugar.
 */
const INHERITED_CONFIG_ALLOWED = new Set(["safe.directory"]);

/** O ambiente do processo sem as variáveis que apontam o git para outro repositório. */
export function gitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  for (const name of REPO_ENV_VARS) delete env[name];
  const kept: [string, string][] = [];
  const count = Number(env.GIT_CONFIG_COUNT ?? 0);
  for (let i = 0; i < (Number.isInteger(count) ? count : 0); i++) {
    const key = env[`GIT_CONFIG_KEY_${i}`];
    if (key && INHERITED_CONFIG_ALLOWED.has(key.toLowerCase())) kept.push([key, env[`GIT_CONFIG_VALUE_${i}`] ?? ""]);
  }
  for (const name of Object.keys(env)) if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(name)) delete env[name];
  if (kept.length) {
    env.GIT_CONFIG_COUNT = String(kept.length);
    kept.forEach(([key, value], i) => {
      env[`GIT_CONFIG_KEY_${i}`] = key;
      env[`GIT_CONFIG_VALUE_${i}`] = value;
    });
  }
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

/**
 * Branch padrão do remoto `origin` (ex.: `main`). Usa `origin/HEAD` quando ele aponta para um ref que existe; um
 * `origin/HEAD` pendente (branch apagada) ou ausente cai para o que o remoto anuncia em `ls-remote --symref`.
 */
export async function defaultBranch(cwd: string): Promise<string> {
  const local = await git(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]).catch(() => "");
  const ref = local.trim();
  if (
    ref &&
    (await git(cwd, ["rev-parse", "--verify", "--quiet", ref]).then(
      () => true,
      () => false,
    ))
  )
    return ref.replace(/^refs\/remotes\/origin\//, "");
  const remote = await git(cwd, ["ls-remote", "--symref", "origin", "HEAD"]);
  const match = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(remote);
  if (!match?.[1]) throw new GitError(["ls-remote", "--symref", "origin", "HEAD"], null, "remoto sem HEAD simbólico");
  return match[1];
}

/**
 * Referência local da branch padrão do remoto (`refs/remotes/origin/<branch>`), buscada no remoto quando o clone não
 * a tem (clone de outra branch, refspec restrito): o review compara contra ela sem cair em erro bruto do git.
 */
export async function remoteDefaultRef(cwd: string, branch?: string): Promise<string> {
  const name = branch ?? (await defaultBranch(cwd));
  const ref = `refs/remotes/origin/${name}`;
  const exists = await git(cwd, ["rev-parse", "--verify", "--quiet", ref]).then(
    () => true,
    () => false,
  );
  if (!exists) await git(cwd, ["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${name}:${ref}`]);
  return ref;
}
