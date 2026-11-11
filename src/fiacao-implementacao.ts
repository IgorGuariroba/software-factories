import type { Harness } from "@earendil-works/pi-durable";
import { resolverAgenteDaEtapa } from "./agente-etapa-config.js";
import { synchronizeBase } from "./base-sync.js";
import { runDelivery } from "./delivery-stage.js";
import type { Card } from "./demand-source.js";
import { type FactoryState, type Question, type QueuedTask, StateDoc, type StepRuntime } from "./durable.js";
import { tarefaDoEstado } from "./estado-fabrica.js";
import type { EventRecorder, NewEvent } from "./events.js";
import type { FiacaoTarefa, ProjetoDaTarefa } from "./fiacao-tarefa.js";
import { runImplementation, StageBlocked } from "./implement-stage.js";
import { pendingQuestion } from "./packages/perguntas/index.js";
import {
  deveRegistrarProgresso,
  entregaParaImplementar,
  type PortasEtapa,
  type PortasRepositorio,
  podeReavaliarCorrecoes,
  resultadoDaReavaliacao,
  type TarefaEtapa,
} from "./packages/tarefa/index.js";
import { repositoryQuestion, resolveRepository } from "./repo-resolver.js";
import { runReview } from "./review-stage.js";
import { redactSecrets } from "./secrets.js";

/** O que a implementação, a revisão, a entrega e a escolha de repositório precisam desta Tarefa. */
export interface ContextoImplementacao {
  input: { id: string; project: string; key: string };
  runtime: StepRuntime;
  harness: Harness;
  lerEstado: () => Promise<FactoryState>;
  lerTarefa: () => Promise<QueuedTask | undefined>;
  cartao: () => Promise<Card>;
  eventos: Pick<EventRecorder, "list"> & { append(event: NewEvent): Promise<void> | void };
  projeto: ProjetoDaTarefa;
  implementationDeps: FiacaoTarefa["implementationDeps"];
  implementationTools: FiacaoTarefa["implementationTools"];
  reviewTools: FiacaoTarefa["reviewTools"];
  ask: (previous: Question[], text: string, origin: Question["origin"], purpose?: Question["purpose"]) => Promise<void>;
}

/** Portas da implementação, revisão, entrega e repositório de uma Tarefa. */
export function criarImplementacaoDaTarefa(ctx: ContextoImplementacao) {
  const {
    input,
    runtime,
    harness,
    lerEstado,
    lerTarefa,
    cartao,
    eventos,
    projeto,
    implementationDeps,
    implementationTools,
    reviewTools,
    ask,
  } = ctx;
  const { writer } = projeto;

  async function implement(repositoryPath?: string): Promise<void> {
    const current = await lerTarefa();
    if (!current?.delivery) throw new Error(`a etapa SPEC não deixou Tickets para ${input.key}`);
    const card = await cartao();
    if (current.implementation?.synchronization?.status === "iniciada") await syncBase();
    const entrega = entregaParaImplementar(current.delivery, current.correctionTickets);
    await runImplementation({
      repositoryPath,
      harness: harness,
      runtime,
      taskId: input.id,
      config: projeto.config,
      codeHost: projeto.codeHost,
      writer,
      card,
      delivery: { ...current.delivery, tickets: entrega.tickets },
      agente: resolverAgenteDaEtapa(projeto.config, "implementacao"),
      deps: implementationDeps,
      tools: implementationTools,
      originalTicketCount: entrega.originalTicketCount,
      canReassessCorrections: async (head) => {
        const latest = await lerTarefa();
        return podeReavaliarCorrecoes(latest?.review, head);
      },
      reassessCorrections: async (head, diagnostic) => {
        const verdict = await runReview({
          harness: harness,
          runtime,
          taskId: input.id,
          config: projeto.config,
          worktreesRoot: implementationDeps.worktreesRoot,
          tools: reviewTools,
          agente: resolverAgenteDaEtapa(projeto.config, "review"),
          verification: { head, diagnostic },
        });
        const latest = await lerTarefa();
        return resultadoDaReavaliacao(verdict, latest?.review);
      },
    });
  }

  /** Registra progresso sem repetir: `ever` compara com todo o histórico (review recuperado), senão só com o último. */
  async function progressOnce(message: string, ever = false): Promise<void> {
    const previous = eventos
      .list()
      .filter((e) => e.type === "progress" && e.project === input.project && e.target === input.key)
      .map((e) => (e.type === "progress" ? e.message : ""));
    if (deveRegistrarProgresso(previous, message, ever))
      await eventos.append({ type: "progress", project: input.project, target: input.key, message });
  }

  /** Portas da orquestração de revisão e entrega (pacote tarefa), com o trabalho desta Tarefa. */
  function etapaPortas(): PortasEtapa {
    return {
      estado: async () => (await lerTarefa()) as TarefaEtapa | undefined,
      alterar: async (fn) => {
        await runtime.commit(async (tx) => {
          const tarefa = tarefaDoEstado(await tx.doc(StateDoc), input.id);
          if (tarefa) fn(tarefa as unknown as TarefaEtapa);
        });
      },
      progresso: (mensagem, historico = false) => progressOnce(mensagem, historico),
      implementar: () => implement(),
      sincronizarBase: () => syncBase(),
      revisar: (feedback) =>
        runReview({
          harness: harness,
          runtime,
          taskId: input.id,
          config: projeto.config,
          worktreesRoot: implementationDeps.worktreesRoot,
          tools: reviewTools,
          agente: resolverAgenteDaEtapa(projeto.config, "review"),
          feedback,
        }),
      emEnsaio: () => projeto.config.dryRun,
      requisicaoDaTarefa: async () => {
        const atual = (await lerEstado()).tasks.find((t) => t.id === input.id);
        return { worktree: atual?.implementation?.worktree, numero: atual?.publication?.number };
      },
      consultarRequisicao: async (worktree, numero) => (await projeto.codeHost.inspectRequest(worktree, numero)).state,
      entregar: () =>
        runDelivery({
          taskId: input.id,
          runtime,
          config: projeto.config,
          codeHost: projeto.codeHost,
          writer,
          worktreesRoot: implementationDeps.worktreesRoot,
        }),
      mensagemDeBloqueio: (erro) => (erro instanceof StageBlocked ? erro.message : undefined),
      redigir: (texto) => redactSecrets(texto),
    };
  }

  async function syncBase(): Promise<boolean> {
    return synchronizeBase({
      taskId: input.id,
      runtime,
      harness: harness,
      config: projeto.config,
      deps: implementationDeps,
    });
  }

  /** Escolha do repositório da Tarefa: a regra está no pacote tarefa; o card, o projeto e as f.perguntas ficam aqui. */
  function portasRepositorio(): PortasRepositorio {
    return {
      cartao: async () => {
        const card = await cartao();
        return card;
      },
      caminhoEscolhido: async () => (await lerEstado()).tasks.find((task) => task.id === input.id)?.repositoryPath,
      repositorios: () => projeto.config.repositories,
      resolverPeloCard: (card) => resolveRepository(projeto.config.repositories, card),
      perguntaPendente: async () => {
        const current = (await lerEstado()).tasks.find((task) => task.id === input.id);
        return current !== undefined && pendingQuestion(current) !== undefined;
      },
      perguntarRepositorio: async (card, repositorios) => {
        const current = (await lerEstado()).tasks.find((task) => task.id === input.id);
        await ask(current?.questions ?? [], repositoryQuestion(card, repositorios), "tecnica", "repositorio");
      },
    };
  }

  return { implement, progressOnce, etapaPortas, syncBase, portasRepositorio };
}
