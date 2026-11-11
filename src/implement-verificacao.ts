import { readFile } from "node:fs/promises";
import type { FormatCommand } from "./config.js";
import type { ImplementationProgress } from "./durable.js";
import type { EventRecorder } from "./events.js";
import { git } from "./git.js";
import { caminhosTocadosDesde, descartarCaminhos } from "./implement-clone.js";
import { redactSecrets } from "./secrets.js";
import type { TestRun, TestRunner } from "./test-runner.js";
import { changedPaths, confine } from "./workspace.js";

// Verificação do clone antes e durante a implementação: a linha de base da suíte, a recuperação limitada do ambiente e
// o passo mecânico do formatador. A etapa de implementação (implement-stage.ts) decide quando rodar cada um.

/** Bloqueio da Tarefa que precisa de uma decisão humana (repositório sem mapeamento, TDD recusado no limite, clone perdido). */
/** A Tarefa não pode seguir sem uma decisão humana (ex.: repositório sem mapeamento, TDD recusado no limite). */
export class StageBlocked extends Error {
  override name = "StageBlocked";
}

/** Motivo persistido usado para reconhecer uma retomada que só precisa medir novamente o baseline. */
export const baselineBlockedReason = (branch: string): string =>
  `a suíte de testes já falha na branch ${branch} antes do primeiro teste novo (linha de base ` +
  "vermelha); a fábrica não tem como verificar o TDD até a suíte voltar a passar";

/** Bloqueio recuperável sem descartar um reparo versionado feito pela pessoa no clone. */
export const baselineWorkspaceBlockedReason = (branch: string): string =>
  `a branch ${branch} tem alterações versionadas pendentes antes da linha de base; ` +
  "preserve o reparo fora deste clone e deixe índice e arquivos versionados limpos antes de retomar";

/** O que a verificação precisa do clone e da etapa, sem depender da própria etapa. */
export interface ContextoVerificacao {
  worktree: string;
  progress: ImplementationProgress;
  signal: AbortSignal;
  testRunner: TestRunner;
  events: EventRecorder;
  /** Projeto e card, para os eventos. */
  projeto: string;
  alvo: string;
  /** Grava o progresso da etapa. */
  salvar(): Promise<void>;
  /** Roda a suíte configurada no clone. */
  runSuite(requireExecutable?: boolean): Promise<TestRun>;
  /** Mensagem do commit de estilo, na convenção do repositório. */
  styleMessage(): string;
  /** Formatador do repositório, quando o mapeamento tem um. */
  formatoDoRepositorio(): FormatCommand | undefined;
}

export const describeRun = (run: TestRun) =>
  run.spawnError
    ? `o comando de teste não executou: ${run.spawnError}`
    : `${run.timedOut ? "tempo esgotado" : `código de saída ${run.exitCode}`}\n${run.output}`;

/**
 * Passo mecânico: roda o formatador do repositório e commita o que mudou como estilo, inclusive em testes. O código
 * de saída não importa (formatadores saem com erro quando sobra achado que não sabem corrigir); não executar, sim.
 */
export async function aplicarFormatador(ctx: ContextoVerificacao): Promise<void> {
  const format = ctx.progress.format ?? ctx.formatoDoRepositorio();
  if (!format) return;
  // Só sobre o HEAD limpo: não mistura tentativa não aceita do implementador num commit de estilo.
  if ((await changedPaths(ctx.worktree)).length > 0) return;
  const run = await ctx.testRunner.run({
    cwd: ctx.worktree,
    command: format.command,
    timeoutMs: format.timeoutSeconds * 1000,
    signal: ctx.signal,
  });
  if (run.spawnError || run.timedOut || ctx.signal.aborted) {
    // Formatação pela metade não pode sobrar na árvore: entraria na próxima fase do TDD (inclusive em testes).
    const partial = await changedPaths(ctx.worktree);
    if (partial.length > 0) await descartarCaminhos(ctx.worktree, partial);
    ctx.signal.throwIfAborted();
    throw new StageBlocked(`o formatador do repositório não concluiu: ${run.spawnError ?? "tempo esgotado"}`);
  }
  // Só o que a Tarefa já tocou: formatar o resto do repositório poluiria a entrega com arquivos alheios.
  const first = ctx.progress.commits[0]?.sha;
  const base = ctx.progress.baseHead ?? (first ? `${first}^` : undefined);
  const touched = base ? await caminhosTocadosDesde(ctx.worktree, base) : new Set<string>();
  const changed = await changedPaths(ctx.worktree);
  const outside = changed.filter((p) => !touched.has(p));
  if (outside.length > 0) await descartarCaminhos(ctx.worktree, outside);
  const paths = changed.filter((p) => touched.has(p));
  if (paths.length === 0) return;
  ctx.signal.throwIfAborted();
  await git(ctx.worktree, ["--literal-pathspecs", "add", "-A", "--", ...paths]);
  await git(ctx.worktree, ["commit", "--quiet", "-m", ctx.styleMessage()]);
  ctx.progress.head = (await git(ctx.worktree, ["rev-parse", "HEAD"])).trim();
  ctx.progress.pushed = false;
  await ctx.salvar();
  await ctx.events.append({
    type: "progress",
    project: ctx.projeto,
    target: ctx.alvo,
    message: `Commit ${ctx.progress.head.slice(0, 8)}: formatador do repositório (${paths.length} arquivo(s))`,
  });
}

/**
 * Linha de base: antes do primeiro teste novo, a suíte precisa passar no estado da branch. Se ela já falha, a falha
 * da fase de teste não provaria nada sobre o teste novo, e a Tarefa bloqueia para uma pessoa decidir.
 */
export async function verificarLinhaDeBase(ctx: ContextoVerificacao): Promise<void> {
  if (!ctx.progress.baseline) {
    // Progresso anterior à linha de base, já com commits: a fase de teste dele já foi aceita.
    if (ctx.progress.commits.length > 0) return;
    // Não mede sobre reparos humanos que a verificação de fase poderia descartar depois.
    // diff HEAD cobre índice e working tree, inclusive arquivos adicionados ao índice.
    const pending = await git(ctx.worktree, ["diff", "--name-only", "-z", "--no-renames", "HEAD"]);
    if (pending.length > 0) throw new StageBlocked(baselineWorkspaceBlockedReason(ctx.progress.branch));
    let run = await ctx.runSuite(false);
    run = await recuperarAmbiente(ctx, run);
    ctx.progress.baselineDiagnostic = redactSecrets(describeRun(run));
    ctx.progress.baseline = run.exitCode === 0 && !run.timedOut && !run.spawnError ? "verde" : "vermelha";
    await ctx.salvar();
  }
  if (ctx.progress.baseline === "vermelha") throw new StageBlocked(baselineBlockedReason(ctx.progress.branch));
}

/** Recuperação limitada: só dependência de pacote ausente, com npm lockfile, sem shell nem scripts. */
async function recuperarAmbiente(ctx: ContextoVerificacao, run: TestRun): Promise<TestRun> {
  if (run.exitCode === 0 || run.timedOut || ctx.progress.environmentRecovery?.attempts) return run;
  const missingPackage = /(?:Cannot find (?:package|module)|Could not resolve) ['"]@?[\w-]+(?:\/[\w.-]+)?['"]/;
  if (!missingPackage.test(run.output)) return run;
  const manifest = JSON.parse(await readFile(await confine(ctx.worktree, "package.json"), "utf8").catch(() => "null"));
  const lock = JSON.parse(await readFile(await confine(ctx.worktree, "package-lock.json"), "utf8").catch(() => "null"));
  if (!manifest || !lock?.lockfileVersion || (manifest.packageManager && !manifest.packageManager.startsWith("npm@")))
    return run;
  // A instalação não pode introduzir dependências que depois sejam incluídas nos commits do TDD.
  const ignored = await git(ctx.worktree, ["check-ignore", "node_modules/"]).catch(() => "");
  if (!ignored.trim()) return run;
  ctx.progress.baselineDiagnostic = redactSecrets(describeRun(run));
  ctx.progress.environmentRecovery = { attempts: 1, status: "iniciada", diagnostic: ctx.progress.baselineDiagnostic };
  await ctx.salvar();
  const setup = await ctx.testRunner.run({
    cwd: ctx.worktree,
    command: ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    timeoutMs: 120_000,
    signal: ctx.signal,
  });
  ctx.progress.environmentRecovery.diagnostic = redactSecrets(describeRun(setup));
  ctx.progress.environmentRecovery.status = "falhou";
  await ctx.salvar();
  const pending = await git(ctx.worktree, ["diff", "--name-only", "-z", "--no-renames", "HEAD"]);
  if (pending.length > 0) throw new StageBlocked(baselineWorkspaceBlockedReason(ctx.progress.branch));
  if (setup.exitCode !== 0 || setup.timedOut || setup.spawnError) return run;
  const measured = await ctx.runSuite(false);
  if (measured.exitCode === 0 && !measured.timedOut && !measured.spawnError)
    ctx.progress.environmentRecovery.status = "recuperado";
  await ctx.salvar();
  return measured;
}
