import type { Context } from "@earendil-works/chord/context";
import { type Harness, ROOT_CONVERSATION_ID, type TaskId } from "@earendil-works/pi-durable";
import { nextProjectActivity } from "./business-hours.js";
import type { CardState, ProjectConfig } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import { type FactoryState, StateDoc } from "./durable.js";
import { novaTarefa } from "./estado-fabrica.js";
import type { EventRecorder, NewEvent } from "./events.js";
import type { FactoryClock } from "./factory.js";
import {
  ativarTarefa,
  buscarNaFonte,
  cardsElegiveis,
  criarEscalonador,
  type EstadoAtivacao,
  type PortasAtivacao,
  type PortasBuscaCompleta,
  tarefasNovas,
} from "./packages/escalonador/index.js";
import type { Perguntas } from "./packages/perguntas/index.js";
import type { EstadoProjetos } from "./packages/projetos/index.js";
import { projetoPausado } from "./projeto-pausa.js";
import { repoDesativado } from "./repositorios.js";
import { newTaskRef } from "./retro-stage.js";
import { redactSecrets } from "./secrets.js";
import type { createTarefaTask } from "./tarefa-task.js";

/** Peças da fábrica que o escalonador usa: a execução das Tarefas, o estado, as Fontes e as perguntas. */
export interface DepsEscalonadorFabrica {
  harness: Harness;
  context: Context;
  Tarefa: ReturnType<typeof createTarefaTask>;
  projects: ReadonlyMap<string, { config: ProjectConfig; source: DemandSource }>;
  readState(): Promise<FactoryState>;
  events: EventRecorder;
  clock: FactoryClock;
  armTimer: (callback: () => void, delayMs: number) => () => void;
  perguntas: Perguntas;
  /** Reconciliação com o GitHub; chamada só quando a busca roda (a fábrica a define depois). */
  reconcileRepos(): Promise<void>;
  pendenciasBloqueantes(nome: string, estado: FactoryState): string[];
}

/**
 * Monta o escalonador: a ativação de uma Tarefa por vez e a busca na Fonte. A fábrica fornece a execução (criar a
 * execução durável, buscar na Fonte, gravar as Tarefas novas, publicar eventos); a regra está nos pacotes.
 */
export async function montarEscalonador(deps: DepsEscalonadorFabrica) {
  const {
    harness,
    context,
    Tarefa,
    projects,
    readState,
    events,
    clock,
    armTimer,
    perguntas,
    reconcileRepos,
    pendenciasBloqueantes,
  } = deps;
  const comoEstadoDaFabrica = (estado: EstadoProjetos) => estado as unknown as FactoryState;
  // --- Escalonador ------------------------------------------------------------------------------
  // Fila de buscas e sincronizações, reações a mudanças de estado e escolha da próxima Tarefa: no pacote escalonador.
  // A fábrica fornece a execução: buscar na Fonte, gravar a ativação e publicar eventos.
  // Ativação da próxima Tarefa (uma por vez): a regra está no escalonador. A fábrica cria a execução durável dentro
  // da transação, ou abre o portão em que a Tarefa esperava.
  const portasAtivacao: PortasAtivacao = {
    alterar: (fn) =>
      harness.commit(
        async (tx) =>
          fn((await tx.doc(StateDoc)) as unknown as EstadoAtivacao, (alvo) =>
            tx.createTask(Tarefa, alvo, {
              ownership: { kind: "conversation" },
              conversationId: ROOT_CONVERSATION_ID,
            }),
          ),
        context,
      ),
    abrirPortao: async (idPortao) => {
      await harness.abortTask(idPortao as TaskId, context);
    },
  };
  // Busca na Fonte e fila de cards elegíveis: a regra de elegibilidade e a sequência da busca estão no escalonador. A
  // fábrica fornece os projetos e as fontes, a sincronização, as perguntas e a gravação das Tarefas novas.
  const portasBusca: PortasBuscaCompleta = {
    projetos: () =>
      [...projects.values()].map(({ config, source }) => ({
        nome: config.name,
        github: config.source.type === "github",
        assignee: config.source.assignee,
        statuses: config.statuses,
        keys: config.source.keys,
        listarAtribuidos: (assignee) => source.listAssignedCards(assignee),
      })),
    estado: () => readState(),
    repoDesativado: (estado, nome) => repoDesativado(estado as FactoryState, nome),
    projetoPausado: (estado, nome) => projetoPausado(estado as FactoryState, nome),
    pendenciasBloqueantes: (nome, estado) => pendenciasBloqueantes(nome, estado as FactoryState),
    sincronizarRepositorios: () => reconcileRepos(),
    registrarErroSincronizacao: (erro) =>
      console.error("[fábrica] sincronização com o GitHub falhou:", redactSecrets(String(erro))),
    verificarPerguntas: () => perguntas.verificar(),
    enfileirar: async (itens) => {
      await harness.commit(async (tx) => {
        const state = await tx.doc(StateDoc);
        // Quais cards viram Tarefa agora é regra do pacote escalonador (não repete o que já existe nem o lote).
        for (const item of tarefasNovas(
          itens,
          state.tasks.map((t) => t.id),
        )) {
          state.tasks.push(
            novaTarefa({
              id: `${item.project}/${item.key}`,
              project: item.project,
              key: item.key,
              title: item.title,
              ref: newTaskRef(),
              startedIn: item.state as CardState,
            }),
          );
        }
      }, context);
    },
  };

  const escalonador = await criarEscalonador({
    buscar: () => buscarNaFonte(portasBusca),
    estado: () => readState(),
    agora: () => clock.now(),
    armTimer,
    proximaAtividade: (nome, agora) => {
      const projeto = projects.get(nome);
      return projeto ? nextProjectActivity(projeto.config, agora) : agora;
    },
    projetoConfigurado: (nome) => projects.has(nome),
    pendenciasBloqueantes: (nome, estado) => pendenciasBloqueantes(nome, comoEstadoDaFabrica(estado)),
    repoDesativado: (estado, projeto) => repoDesativado(comoEstadoDaFabrica(estado), projeto),
    projetoPausado: (estado, projeto) => projetoPausado(comoEstadoDaFabrica(estado), projeto),
    ativar: (id) => ativarTarefa(portasAtivacao, id),
    registrarEvento: async (evento) => {
      await events.append(evento as NewEvent);
    },
    registrarErro: (mensagem, erro) => console.error(mensagem, erro),
  });
  return { escalonador, filaElegivel: () => cardsElegiveis(portasBusca) };
}
