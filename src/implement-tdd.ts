import { formatCommitMessage } from "./conventions.js";
import type { TddPhase } from "./durable.js";
import { commitarCaminhos, descartarCaminhos } from "./implement-clone.js";
import type { ContextoVerificacao } from "./implement-verificacao.js";
import { describeRun, StageBlocked } from "./implement-verificacao.js";
import { arquivosForaDaFase, julgamentoDaSuite, regraDaFase } from "./packages/tdd-etapa/index.js";
import { testDiagnostic } from "./test-diagnostic.js";
import type { TestRun } from "./test-runner.js";
import { changedPaths, isTestFile } from "./workspace.js";

// Fase do TDD na implementação: rodar a suíte, conferir o que a fase tocou e commitar exatamente o verificado.

/** Contexto de uma fase: a verificação do clone e a convenção de commit e o card (para o título do commit). */
export interface ContextoFase extends ContextoVerificacao {
  conventions: Parameters<typeof formatCommitMessage>[0];
}

/** Roda a suíte configurada no clone. Um comando que nem executa bloqueia a Tarefa. */
export async function rodarSuite(
  ctx: Pick<ContextoVerificacao, "worktree" | "progress" | "signal" | "testRunner">,
  requireExecutable = true,
): Promise<TestRun> {
  const run = await ctx.testRunner.run({
    cwd: ctx.worktree,
    command: ctx.progress.test.command,
    timeoutMs: ctx.progress.test.timeoutSeconds * 1000,
    signal: ctx.signal,
  });
  if (run.spawnError && requireExecutable) throw new StageBlocked(`o comando de teste não executa: ${run.spawnError}`);
  return run;
}

/** Confere a fase: devolve os caminhos a commitar, ou por que recusou. */
export async function verificarFase(ctx: ContextoVerificacao, phase: TddPhase): Promise<string[] | string> {
  const paths = await changedPaths(ctx.worktree);
  if (paths.length === 0) return "nenhum arquivo mudou";
  // Cada fase só toca o seu lado (regra no pacote tdd-etapa): o teste não traz código, e o código não afrouxa nem apaga o teste.
  const outside = arquivosForaDaFase(paths, (p) => isTestFile(p, ctx.progress.test.files), phase);
  if (outside.length > 0) {
    // O que a fase não pode tocar volta ao último commit: o modelo não tem como apagar um arquivo novo.
    await descartarCaminhos(ctx.worktree, outside);
    return `${regraDaFase(phase, ctx.progress.test.files)}; a fábrica descartou as mudanças em: ${outside.join(", ")}`;
  }
  const run = await rodarSuite(ctx);
  const julgamento = julgamentoDaSuite(phase, run);
  if (julgamento === "estourou") return `os testes estouraram ${ctx.progress.test.timeoutSeconds}s\n${run.output}`;
  if (julgamento === "sinal") return `os testes foram interrompidos por um sinal\n${run.output}`;
  if (julgamento === "passou-na-fase-de-teste")
    return `os testes passaram; o teste novo precisa falhar antes da implementação\n${run.output}`;
  if (julgamento === "falhou-na-implementacao") return `os testes falharam\n${testDiagnostic(describeRun(run))}`;
  return paths;
}

/** Commita exatamente os caminhos verificados, na convenção do repositório. Nunca um commit vazio. */
export async function commitarFase(
  ctx: ContextoFase,
  paths: string[],
  phase: TddPhase,
  title: string,
): Promise<string> {
  ctx.signal.throwIfAborted();
  const message = formatCommitMessage(ctx.conventions, {
    type: phase === "teste" ? "test" : "feat",
    summary: phase === "teste" ? `adiciona teste para ${title}` : title,
    key: ctx.alvo,
  });
  return commitarCaminhos(ctx.worktree, paths, message);
}
