import type { CodeHost } from "./code-host.js";
import type { ProjectConfig } from "./config.js";
import { copyOutOfCommit, type QueuedTask, StateDoc, type StepRuntime } from "./durable.js";
import type { EffectWriter } from "./effect-writer.js";
import { defaultBranch, git } from "./git.js";
import { StageBlocked } from "./implement-stage.js";
import { redactSecrets } from "./secrets.js";
import { assertFactoryWorktree } from "./workspace.js";

/** Publica só o HEAD revisado e acompanha o remoto; não há operação de merge. */
export async function runDelivery(opts: {
  taskId: string;
  runtime: StepRuntime;
  config: ProjectConfig;
  codeHost: CodeHost;
  writer: EffectWriter;
  worktreesRoot: string;
}): Promise<"acompanhar" | "revisar" | undefined> {
  const { runtime, config, writer } = opts;
  let task: QueuedTask | undefined;
  await runtime.commit(async (tx) => {
    task = copyOutOfCommit((await tx.doc(StateDoc)).tasks.find((t) => t.id === opts.taskId));
  });
  if (!task?.implementation) return;
  if (config.specApproval && (task.specReview !== "approved" || task.specApprovedDryRun !== config.dryRun))
    throw new StageBlocked("publicação exige nova aprovação da SPEC para o modo atual");
  const progress = task.implementation;
  const cwd = await assertFactoryWorktree(opts.worktreesRoot, progress.worktree);
  const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  if (head !== progress.head || task.review?.head !== head || task.review.status !== "aprovado")
    throw new StageBlocked("publicação exige review aprovado do HEAD atual");
  const pending = await git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (pending.trim())
    throw new StageBlocked("clone com alterações pendentes antes da publicação; preserve o trabalho e investigue");
  if (!progress.pushed) {
    runtime.signal.throwIfAborted();
    await writer.pushBranch(cwd, progress.branch);
    progress.pushed = true;
    await runtime.commit(async (tx) => {
      const queued = (await tx.doc(StateDoc)).tasks.find((t) => t.id === opts.taskId);
      if (queued?.implementation) queued.implementation.pushed = true;
    });
  }
  const base = progress.defaultBranch ?? (await defaultBranch(cwd));
  if (!progress.defaultBranch) {
    // Tarefa anterior ao registro da branch padrão: guarda a descoberta para as retomadas não consultarem o remoto.
    progress.defaultBranch = base;
    await runtime.commit(async (tx) => {
      const queued = (await tx.doc(StateDoc)).tasks.find((t) => t.id === opts.taskId);
      if (queued?.implementation && !queued.implementation.defaultBranch) queued.implementation.defaultBranch = base;
    });
  }
  const remote =
    task.publication?.number && !config.dryRun
      ? await opts.codeHost.inspectRequest(cwd, task.publication.number)
      : await writer.ensureRequest(task.key, cwd, {
          branch: progress.branch,
          base,
          title: `${task.key}: ${task.title}`,
          body: `## Summary\n\n${task.delivery?.spec ?? ""}\n\n## Evidence\n\n- Baseline verde e ciclo TDD verificado pela fábrica.\n- Comando: ${JSON.stringify(progress.test.command)}\n- HEAD revisado: ${head}\n- Review: ${task.review.summary}\n\n## Merge Danger\n\nMerge exclusivamente humano. CI e comentários serão acompanhados pela fábrica.`,
        });
  if (remote && remote.head !== head)
    throw new StageBlocked("HEAD remoto divergiu do HEAD revisado; a fábrica não sobrescreve mudanças humanas");
  if (remote?.state === "closed")
    throw new StageBlocked(`PR/MR ${remote.url} foi fechado sem merge; decisão humana necessária`);
  if (remote?.conflicts)
    throw new StageBlocked(
      `PR/MR ${remote.url} tem conflitos; preserve o histórico e investigue antes de publicar outra revisão`,
    );
  const feedbackIds = task.publication?.feedbackIds ?? [];
  const unhandled = remote?.feedback.filter((f) => !feedbackIds.includes(f.id)) ?? [];
  const status = !remote
    ? "dry-run"
    : remote.state === "merged"
      ? "merged"
      : unhandled.length > 0
        ? "aguardando-review"
        : remote.checks === "passed"
          ? "aguardando-merge"
          : "aguardando-ci";
  await runtime.commit(async (tx) => {
    const queued = (await tx.doc(StateDoc)).tasks.find((t) => t.id === opts.taskId);
    if (queued) {
      queued.publication = {
        number: remote?.number ?? null,
        url: remote?.url ?? null,
        head,
        status,
        feedbackIds,
        pendingFeedback: unhandled.map((f) => ({ ...f, body: redactSecrets(f.body) })),
      };
      queued.reason = remote && remote.state === "open" ? `${status}: ${remote.url}` : null;
    }
  });
  if (unhandled.length > 0 && remote?.state === "open") return "revisar";
  if (remote?.checks === "failed" && remote.state !== "merged")
    throw new StageBlocked(`CI falhou no PR/MR ${remote.url}; investigar sem aceitar como novo RED`);
  return remote && remote.state === "open" ? "acompanhar" : undefined;
}
