import { git } from "./git.js";
import { fatosDoRed } from "./implement-clone.js";
import { type ContextoVerificacao, describeRun, StageBlocked } from "./implement-verificacao.js";
import { formatacaoAceitavel, passosDoTdd, proximoPasso, registrarCommitAceito } from "./packages/tdd-etapa/index.js";
import { recoverRepair } from "./repair.js";
import { redactSecrets } from "./secrets.js";
import type { SpecDelivery } from "./spec-stage.js";
import { testDiagnostic } from "./test-diagnostic.js";
import { changedPaths } from "./workspace.js";

/** Renderiza o checklist de Tickets marcando os tickets já implementados. */
export const renderTicketsProgress = (tickets: SpecDelivery["tickets"], done: ReadonlySet<number>): string =>
  tickets.map((t, i) => `- [${done.has(i) ? "x" : " "}] **${i + 1}. ${t.titulo}**: ${t.aceite}`).join("\n");

/** Acrescenta à verificação o que aceitar um passo pede: os tickets, o checklist e a reavaliação de correções. */
export interface ContextoAceitacao extends ContextoVerificacao {
  totalTickets: number;
  tickets: SpecDelivery["tickets"];
  /** Tickets já com commit aceito (ou verificados por reavaliação). */
  feitos(): Set<number>;
  /** Reescreve o checklist de Tickets na Fonte. */
  atualizarChecklist(): Promise<void>;
  correcoes: {
    originalTicketCount?: number;
    canReassessCorrections?: (head: string) => Promise<boolean>;
    reassessCorrections?: (head: string, diagnostic: string) => Promise<{ approved: boolean; feedback?: string }>;
  };
}

/**
 * Um HEAD à frente do registrado por exatamente um commit é o commit do próximo passo, feito antes de a fábrica cair:
 * ele é registrado em vez de refeito. Só a fábrica commita neste clone, então qualquer outra divergência bloqueia.
 */
export async function reconciliarHead(ctx: ContextoAceitacao): Promise<void> {
  const head = (await git(ctx.worktree, ["rev-parse", "HEAD"])).trim();
  if (head === ctx.progress.head) return;
  if (await recoverRepair(ctx.progress, head, ctx.testRunner, ctx.signal)) {
    await ctx.salvar();
    return;
  }
  const parent = (await git(ctx.worktree, ["rev-parse", "HEAD^"]).catch(() => "")).trim();
  // Commit de estilo que caiu antes do registro: não é passo do TDD, só avança o HEAD.
  if (
    parent === ctx.progress.head &&
    (await git(ctx.worktree, ["log", "-1", "--format=%s"])).trim() === ctx.styleMessage()
  ) {
    ctx.progress.head = head;
    ctx.progress.pushed = false;
    await ctx.salvar();
    return;
  }
  const next = proximoPasso(passosDoTdd(ctx.totalTickets), ctx.progress);
  if (parent !== ctx.progress.head || !next)
    throw new StageBlocked(`o histórico do clone ${ctx.worktree} divergiu do registrado (HEAD ${head})`);
  registrarCommitAceito(ctx.progress, next, head);
  await ctx.salvar();
}

/** Não inventa RED/GREEN: registra critérios já atendidos, provados por suíte e review de outra família. */
export async function aceitarCorrecoesSatisfeitas(ctx: ContextoAceitacao): Promise<boolean> {
  const originalCount = ctx.correcoes.originalTicketCount;
  if (!ctx.correcoes.reassessCorrections || originalCount === undefined) return false;
  const missing = ctx.tickets.map((_, ticket) => ticket).filter((ticket) => !ctx.feitos().has(ticket));
  if (!missing.length || missing.some((ticket) => ticket < originalCount)) return false;
  // Um RED pendente continua exigindo implementação; trabalho não aceito não entra na evidência.
  if (
    ctx.progress.commits.some((c) => c.phase === "teste" && missing.includes(c.ticket)) ||
    (await changedPaths(ctx.worktree)).length > 0
  )
    return false;
  const before = (await git(ctx.worktree, ["rev-parse", "HEAD"])).trim();
  if (before !== ctx.progress.head) throw new StageBlocked("HEAD divergiu antes da reavaliação de correções");
  if (ctx.correcoes.canReassessCorrections && !(await ctx.correcoes.canReassessCorrections(before))) return false;
  const run = await ctx.runSuite();
  if (run.timedOut || run.spawnError || run.exitCode !== 0) return false;
  const diagnostic = redactSecrets(testDiagnostic(describeRun(run)));
  const assessment = await ctx.correcoes.reassessCorrections(before, diagnostic);
  if (!assessment.approved) {
    if (assessment.feedback) {
      ctx.progress.feedback = redactSecrets(assessment.feedback);
      await ctx.salvar();
    }
    return false;
  }
  if ((await git(ctx.worktree, ["rev-parse", "HEAD"])).trim() !== before || (await changedPaths(ctx.worktree)).length)
    throw new StageBlocked("clone mudou durante a reavaliação de correções; preserve as alterações");
  ctx.progress.verifiedTickets ??= [];
  for (const ticket of missing) ctx.progress.verifiedTickets.push({ ticket, sha: before, diagnostic });
  ctx.progress.rejections = 0;
  ctx.progress.feedback = null;
  await ctx.salvar();
  await ctx.atualizarChecklist();
  await ctx.events.append({
    type: "progress",
    project: ctx.projeto,
    target: ctx.alvo,
    message: `Correções ${missing.map((ticket) => ticket + 1).join(", ")}: critério já atendido no HEAD ${before.slice(0, 8)}; suíte GREEN e review independente. Sem RED artificial ou commit vazio.`,
  });
  return true;
}

export async function aceitarFaseFormatada(ctx: ContextoAceitacao, ticket: number): Promise<boolean> {
  const red = ctx.progress.commits.find((commit) => commit.ticket === ticket && commit.phase === "teste");
  // Os fatos vêm do git; a decisão está no pacote tdd-etapa. Sem RED, não há o que comparar.
  const fatos = red ? await fatosDoRed(ctx.worktree, red.sha, ctx.progress.head) : undefined;
  const aceitavel = formatacaoAceitavel({
    temRed: Boolean(red),
    headAvancou: red !== undefined && red.sha !== ctx.progress.head,
    arvoreLimpa: (await changedPaths(ctx.worktree)).length === 0,
    assuntos: fatos?.assuntos ?? [],
    caminhos: fatos?.caminhos ?? [],
    diffSemEspacos: fatos?.diffSemEspacos ?? "",
    mensagemDeEstilo: ctx.styleMessage(),
  });
  if (!aceitavel) return false;
  const run = await ctx.runSuite();
  if (run.timedOut || run.exitCode !== 0) return false;
  ctx.progress.commits.push({ ticket, phase: "implementacao", sha: ctx.progress.head });
  ctx.progress.rejections = 0;
  ctx.progress.feedback = null;
  ctx.progress.pushed = false;
  await ctx.salvar();
  await ctx.atualizarChecklist();
  await ctx.events.append({
    type: "progress",
    project: ctx.projeto,
    target: ctx.alvo,
    message: `Ticket ${ticket + 1}: RED resolvido pelo formatador, suíte GREEN verificada; commit ${ctx.progress.head.slice(0, 8)}. Nenhum commit vazio criado.`,
  });
  return true;
}
