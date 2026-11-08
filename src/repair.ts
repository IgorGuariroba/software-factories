import { createHash } from "node:crypto";
import type { ImplementationProgress, QueuedTask } from "./durable.js";
import { git } from "./git.js";
import { testDiagnostic } from "./test-diagnostic.js";
import type { TestRunner } from "./test-runner.js";
import { assertFactoryWorktree, changedPaths, confine } from "./workspace.js";

export class RepairConflict extends Error {}

const digest = (base: string, diff: string) => createHash("sha256").update(`${base}\n${diff}`).digest("hex");
const repairMessage = (base: string, revision: string, ticket: number) =>
  `chore: factory-repair ${base} ${revision} ticket=${ticket}`;

/** Prévia exata dos reparos locais já existentes; não cria nem descarta arquivos. */
export async function repairPreview(task: QueuedTask, root: string) {
  const progress = task.implementation;
  if (
    task.status !== "bloqueada" ||
    task.stage !== "implementacao" ||
    !progress ||
    !task.reason?.startsWith("TDD recusado ")
  )
    throw new RepairConflict("reparo exige tarefa bloqueada por TDD na implementação");
  const cwd = await assertFactoryWorktree(root, progress.worktree);
  const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  if (head !== progress.head) throw new RepairConflict("HEAD divergiu do checkpoint");
  if ((await git(cwd, ["branch", "--show-current"])).trim() !== progress.branch)
    throw new RepairConflict("branch divergiu do checkpoint");
  const paths = await changedPaths(cwd);
  if (!paths.length) throw new RepairConflict("nenhum reparo local para integrar");
  for (const path of paths) await confine(cwd, path);
  // Esta operação trata reparos de arquivos rastreados, sem incluir acidentalmente arquivos novos.
  const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  if (untracked.trim()) throw new RepairConflict("arquivos novos exigem revisão separada");
  const diff = await git(cwd, ["diff", "--binary", "--full-index", "HEAD"]);
  const red = progress.commits.find(
    (commit) =>
      commit.phase === "teste" &&
      !progress.commits.some((other) => other.ticket === commit.ticket && other.phase === "implementacao"),
  );
  if (!red) throw new RepairConflict("nenhuma fase RED registrada aguardando implementação");
  return { head, revision: digest(head, diff), paths, diff, ticket: red.ticket };
}

async function validate(cwd: string, progress: ImplementationProgress, runner: TestRunner, signal?: AbortSignal) {
  const run = await runner.run({
    cwd,
    command: progress.test.command,
    timeoutMs: progress.test.timeoutSeconds * 1000,
    signal,
  });
  if (run.spawnError || run.timedOut || run.exitCode !== 0)
    throw new RepairConflict(`reparo não passou na suíte: ${run.spawnError ?? testDiagnostic(run.output)}`);
}

function record(progress: ImplementationProgress, sha: string, ticket: number, revision: string) {
  progress.head = sha;
  progress.pushed = false;
  progress.rejections = 0;
  progress.feedback = null;
  progress.repairs ??= [];
  if (!progress.repairs.some((repair) => repair.sha === sha)) progress.repairs.push({ sha, ticket, revision });
  if (!progress.commits.some((commit) => commit.ticket === ticket && commit.phase === "implementacao"))
    progress.commits.push({ sha, ticket, phase: "implementacao" });
}

/** Só chamada após aprovação explícita da revisão exata e com a Tarefa bloqueada. Não retoma nem publica. */
export async function integrateRepair(
  task: QueuedTask,
  root: string,
  revision: string,
  runner: TestRunner,
  signal?: AbortSignal,
) {
  const preview = await repairPreview(task, root);
  if (preview.revision !== revision) throw new RepairConflict("revisão do reparo mudou; revise novamente");
  const progress = task.implementation;
  if (!progress) throw new RepairConflict("implementação ausente");
  await validate(progress.worktree, progress, runner, signal);
  if ((await repairPreview(task, root)).revision !== revision)
    throw new RepairConflict("arquivos mudaram durante a validação");
  signal?.throwIfAborted();
  await git(progress.worktree, ["--literal-pathspecs", "add", "-A", "--", ...preview.paths]);
  await git(progress.worktree, ["commit", "--quiet", "-m", repairMessage(preview.head, revision, preview.ticket)]);
  const sha = (await git(progress.worktree, ["rev-parse", "HEAD"])).trim();
  record(progress, sha, preview.ticket, revision);
  return { sha, ticket: preview.ticket, paths: preview.paths };
}

/** Recupera queda entre commit Git e checkpoint durável, sem interpretar reparo como TDD do modelo. */
export async function recoverRepair(
  progress: ImplementationProgress,
  head: string,
  runner: TestRunner,
  signal?: AbortSignal,
) {
  const subject = (await git(progress.worktree, ["log", "-1", "--format=%s"])).trim();
  const match = subject.match(/^chore: factory-repair ([0-9a-f]{40}) ([0-9a-f]{64}) ticket=(\d+)$/);
  if (!match || match[1] !== progress.head) return false;
  if ((await git(progress.worktree, ["rev-parse", "HEAD^"])).trim() !== progress.head) return false;
  const ticket = Number(match[3]);
  if (!progress.commits.some((commit) => commit.ticket === ticket && commit.phase === "teste")) return false;
  if ((await changedPaths(progress.worktree)).length)
    throw new RepairConflict("reparo interrompido tem alterações pendentes");
  const diff = await git(progress.worktree, ["diff", "--binary", "--full-index", progress.head, head]);
  if (digest(progress.head, diff) !== match[2]) throw new RepairConflict("revisão do commit de reparo divergiu");
  await validate(progress.worktree, progress, runner, signal);
  record(progress, head, ticket, match[2]);
  return true;
}
