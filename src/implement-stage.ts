import type { Harness } from "@earendil-works/pi-durable";
import type { AgenteDaEtapa } from "./agente-etapa-config.js";
import type { CodeHost } from "./code-host.js";
import type { ProjectConfig } from "./config.js";
import { formatCommitMessage } from "./conventions.js";
import type { Card } from "./demand-source.js";
import { copyOutOfCommit, type ImplementationProgress, StateDoc, type StepRuntime, type TddPhase } from "./durable.js";
import type { EffectWriter } from "./effect-writer.js";
import { tarefaDoEstado } from "./estado-fabrica.js";
import {
  aceitarCorrecoesSatisfeitas,
  aceitarFaseFormatada,
  type ContextoAceitacao,
  reconciliarHead,
  renderTicketsProgress,
} from "./implement-aceitacao.js";
import { iniciarImplementacao } from "./implement-inicio.js";
import { commitarFase, rodarSuite, verificarFase } from "./implement-tdd.js";
import {
  aplicarFormatador,
  type ContextoVerificacao,
  StageBlocked,
  verificarLinhaDeBase,
} from "./implement-verificacao.js";
import {
  MAX_RECUSAS_TDD,
  passoFeito,
  passosDoTdd,
  recusasEsgotadas,
  registrarCommitAceito,
  registrarRecusaTdd,
} from "./packages/tdd-etapa/index.js";
import { resolveRepository } from "./repo-resolver.js";
import { redactSecrets } from "./secrets.js";
import type { SpecDelivery } from "./spec-stage.js";
import { testDiagnostic } from "./test-diagnostic.js";
import { assertFactoryWorktree } from "./workspace.js";

export { baselineBlockedReason, baselineWorkspaceBlockedReason, StageBlocked } from "./implement-verificacao.js";

/** Quantas vezes seguidas a fábrica recusa uma fase do TDD antes de bloquear a Tarefa. */
export const MAX_TDD_REJECTIONS = MAX_RECUSAS_TDD;

/** Rodadas de ferramenta de um pedido ao modelo. */
const MAX_TURNS = 30;

/** Maior arquivo que `ler_arquivo` devolve inteiro. */

const INSTRUCTIONS = `Você é o papel implementador de uma fábrica de software autônoma e trabalha com TDD, ticket a ticket.
Você só tem as ferramentas ler_arquivo, escrever_arquivo e rodar_testes, sempre dentro do repositório.
Não há shell nem git: a fábrica verifica cada fase, roda os testes e faz os commits.
- Fase de teste: escreva só os testes do ticket, incluindo adaptações necessárias dos testes existentes (por exemplo,
  snapshots e listas exatas de rotas ao acrescentar uma API). Preserve as assertions e a cobertura anterior; acrescente
  as expectativas novas antes do código de produção. Não adie essas adaptações para a implementação, que não pode
  alterar testes. A fábrica exige que só arquivos de teste mudem e que os testes falhem.
- Não crie teste que executa toda a suíte dentro da suíte, script auxiliar sem função no produto, falha artificial
  ou mudança de comportamento só para obter RED em um critério já atendido. Validação da suíte é trabalho da fábrica.
- Fase de implementação: escreva o código que faz os testes passarem, sem mexer nos testes. A fábrica exige que
  nenhum arquivo de teste mude e que os testes passem.
Quando terminar a fase, responda em texto, sem chamar ferramentas.`;

export { createImplementationExtension, type ImplementationDeps } from "./implement-ferramentas.js";

import type { ImplementationDeps, ImplementationExtension } from "./implement-ferramentas.js";

export { renderTicketsProgress } from "./implement-aceitacao.js";

function phasePrompt(delivery: SpecDelivery, ticket: number, phase: TddPhase, feedback: string | null): string {
  const t = delivery.tickets[ticket];
  const head = `Ticket ${ticket + 1}/${delivery.tickets.length}: ${t?.titulo}\nCritério de aceite: ${t?.aceite}`;
  const task =
    phase === "teste"
      ? "Fase de teste: escreva o teste que verifica este critério. Ele precisa falhar, porque o código ainda não existe."
      : "Fase de implementação: escreva o código que faz os testes passarem.";
  const refusal = feedback ? `\n\nA fábrica recusou a tentativa anterior desta fase: ${feedback}` : "";
  return `${head}\n\n${task}${refusal}`;
}

/**
 * A etapa de implementação: resolve o repositório, clona para o diretório da fábrica, cria a branch na convenção e
 * implementa ticket a ticket com TDD verificado pela fábrica (teste novo que falha → commit; código que passa →
 * commit), atualizando o checklist de Tickets, e por fim faz push da branch pelo escritor de efeitos.
 * Cada passo é registrado no estado durável; a retomada reconcilia com o histórico do clone antes de seguir.
 */
export async function runImplementation(opts: {
  harness: Harness;
  runtime: StepRuntime;
  /** Id da Tarefa na fila (`<projeto>/<card>`). */
  taskId: string;
  config: ProjectConfig;
  /** Escolha humana por Tarefa. O caminho precisa continuar na allowlist do projeto. */
  repositoryPath?: string;
  codeHost: CodeHost;
  writer: EffectWriter;
  card: Card;
  delivery: SpecDelivery;
  /** Configuração efetiva da implementação (Agente da etapa): modelo, ferramentas e prompt adicional. */
  agente: AgenteDaEtapa;
  deps: ImplementationDeps;
  tools: ImplementationExtension;
  /** Correções podem ficar satisfeitas por outro reparo; os tickets originais nunca usam esta saída. */
  originalTicketCount?: number;
  canReassessCorrections?: (head: string) => Promise<boolean>;
  reassessCorrections?: (head: string, diagnostic: string) => Promise<{ approved: boolean; feedback?: string }>;
}): Promise<void> {
  const { harness, runtime, config, writer, card, delivery, deps } = opts;
  const { context } = runtime;
  // Projeto sem repositórios mapeados: a Tarefa termina nos Tickets.
  if (!config.repositories?.length) return;

  const readProgress = async () => {
    let progress: ImplementationProgress | undefined;
    await runtime.commit(async (tx) => {
      const stored = tarefaDoEstado(await tx.doc(StateDoc), opts.taskId)?.implementation;
      progress = stored ? copyOutOfCommit(stored) : undefined;
    });
    return progress;
  };
  const save = (progress: ImplementationProgress) =>
    runtime.commit(async (tx) => {
      // Depois do fechamento do daemon, o passo cancelado não grava mais nada: a retomada é de outro processo.
      runtime.signal.throwIfAborted();
      const task = tarefaDoEstado(await tx.doc(StateDoc), opts.taskId);
      if (task) task.implementation = copyOutOfCommit(progress);
    });

  const progress = (await readProgress()) ?? (await start());
  const { worktree } = progress;
  await assertFactoryWorktree(deps.worktreesRoot, worktree).catch(() => {
    throw new StageBlocked(`o clone da fábrica ${worktree} sumiu; os commits não enviados se perderam`);
  });
  const conventions = { commit: progress.commitPattern };
  // O que a verificação do clone (linha de base, formatador) precisa desta etapa.
  const verificacao = (): ContextoVerificacao => {
    const base = {
      worktree,
      progress,
      signal: runtime.signal,
      testRunner: deps.testRunner,
      events: deps.events,
      projeto: config.name,
      alvo: card.key,
      salvar: () => save(progress),
      styleMessage,
      formatoDoRepositorio: () => resolveRepository(config.repositories, card)?.format,
    };
    return { ...base, runSuite: (requireExecutable) => rodarSuite(base, requireExecutable) };
  };
  const aceitacao = (): ContextoAceitacao => ({
    ...verificacao(),
    totalTickets: delivery.tickets.length,
    tickets: delivery.tickets,
    feitos: () => done(),
    atualizarChecklist: () =>
      writer.upsertComment(card.key, "Tickets", renderTicketsProgress(delivery.tickets, done())).then(() => undefined),
    correcoes: {
      originalTicketCount: opts.originalTicketCount,
      canReassessCorrections: opts.canReassessCorrections,
      reassessCorrections: opts.reassessCorrections,
    },
  });

  await reconciliarHead(aceitacao());
  // Retomada: o que ficou fora do padrão (ex.: testes de antes do formatador) entra antes do próximo passo.
  await aplicarFormatador(verificacao());
  const done = () =>
    new Set([
      ...progress.commits.filter((c) => c.phase === "implementacao").map((c) => c.ticket),
      ...(progress.verifiedTickets ?? []).map((c) => c.ticket),
    ]);
  await writer.upsertComment(card.key, "Tickets", renderTicketsProgress(delivery.tickets, done()));

  await verificarLinhaDeBase(verificacao());

  const conversation = await harness.conversation(progress.conversationId, context);
  if (!conversation) throw new Error("conversa da etapa de implementação não encontrada");

  for (const step of passosDoTdd(delivery.tickets.length)) {
    if (passoFeito(progress, step)) continue;
    if (step.phase === "teste" && (await aceitarCorrecoesSatisfeitas(aceitacao()))) continue;
    for (;;) {
      // Uma retomada pode ter aplicado formatação que resolveu o RED já registrado.
      // Só reconhece commits mecânicos, sem alterações pendentes ou mudança efetiva nos testes.
      if (step.phase === "implementacao" && (await aceitarFaseFormatada(aceitacao(), step.ticket))) break;
      const requestId = `implementacao-${progress.requests}`;
      const submission = await conversation.submit(
        { type: "input", content: phasePrompt(delivery, step.ticket, step.phase, progress.feedback), requestId },
        context,
      );
      const settled = await submission.wait(context);
      if (settled.status !== "done") {
        // O próximo pedido é outro: repetir este id devolveria a mesma submissão sem resposta.
        progress.requests++;
        await save(progress);
        throw new Error(
          `o implementador não concluiu a fase ${step.phase} do ticket ${step.ticket + 1} (${settled.status})`,
        );
      }
      runtime.signal.throwIfAborted();
      const verdict = await verificarFase(verificacao(), step.phase);
      if (typeof verdict === "string") {
        registrarRecusaTdd(progress, verdict);
        await save(progress);
        await deps.events.append({
          type: "progress",
          project: config.name,
          target: card.key,
          message: `TDD recusado no ticket ${step.ticket + 1} (${step.phase}): ${testDiagnostic(redactSecrets(verdict), 2000)}`,
        });
        if (recusasEsgotadas(progress))
          // Só a primeira linha do veredito: o motivo vai para o Telegram, e a saída da suíte já está no progresso.
          throw new StageBlocked(
            `TDD recusado ${progress.rejections} vezes na fase ${step.phase} do ticket ${step.ticket + 1}: ${redactSecrets(verdict.split("\n")[0] ?? "").slice(0, 160)}. Detalhes na atividade da Tarefa.`,
          );
        continue;
      }
      const ticket = delivery.tickets[step.ticket];
      const sha = await commitarFase({ ...verificacao(), conventions }, verdict, step.phase, ticket?.titulo ?? "");
      await deps.events.append({
        type: "progress",
        project: config.name,
        target: card.key,
        message: `Commit ${sha.slice(0, 8)}: ticket ${step.ticket + 1}/${delivery.tickets.length} (${step.phase === "teste" ? "teste RED" : "implementação GREEN"}) — ${redactSecrets(ticket?.titulo ?? "")}`,
      });
      registrarCommitAceito(progress, step, sha);
      // O checklist sai antes do registro: se a fábrica cair aqui, a retomada reconhece o commit pelo HEAD.
      if (step.phase === "implementacao")
        await writer.upsertComment(card.key, "Tickets", renderTicketsProgress(delivery.tickets, done()));
      await save(progress);
      if (step.phase === "implementacao") await aplicarFormatador(verificacao());
      break;
    }
  }

  // O envio acontece na etapa de entrega, somente depois do review do HEAD final.

  /** Primeira vez: resolve o repositório, clona, cria a branch e a conversa, e registra tudo num commit só. */
  // Início: clone, branch e conversa, no módulo implement-inicio.
  async function start(): Promise<ImplementationProgress> {
    return iniciarImplementacao({
      taskId: opts.taskId,
      repositoryPath: opts.repositoryPath,
      repositories: config.repositories,
      projectName: config.name,
      conventions: config.conventions,
      card,
      worktreesRoot: deps.worktreesRoot,
      events: deps.events,
      codeHost: opts.codeHost,
      runtime,
      agente: opts.agente,
      tools: opts.tools,
      instructions: INSTRUCTIONS,
      maxTurns: MAX_TURNS,
      bloqueio: (mensagem) => new StageBlocked(mensagem),
    });
  }

  function styleMessage(): string {
    return formatCommitMessage(conventions, {
      type: "style",
      summary: "aplica o formatador do repositório",
      key: card.key,
    });
  }
}
