import type { Context } from "@earendil-works/chord/context";
import type { Harness, TaskId } from "@earendil-works/pi-durable";
import { nextProjectActivity } from "./business-hours.js";
import { copyOutOfCommit, type FactoryState, type Question, type QueuedTask, StateDoc } from "./durable.js";
import { encaminharPerguntaTecnica } from "./encaminhamento-tecnico.js";
import { tarefaDoEstado } from "./estado-fabrica.js";
import type { EventRecorder, NewEvent } from "./events.js";
import type { FactoryClock } from "./factory.js";
import type { FiacaoTarefa, ProjetoDaTarefa } from "./fiacao-tarefa.js";
import type { ManagementBridgeDeps } from "./management.js";
import {
  criarControleTarefas,
  type EstadoControle,
  type PortasControle,
  reinspecionarVetos,
} from "./packages/controle-tarefa/index.js";
import { criarDecisoes, type EstadoDecisoes } from "./packages/decisoes/index.js";
import type { Registro } from "./packages/integracoes/lib/registro.js";
import { criarPerguntas, pendingQuestion, registrarRespostaNoEstado } from "./packages/perguntas/index.js";
import { avisoTeamsDe, identidadeTeams, pessoasDoPapel } from "./packages/profiles/index.js";
import type { EstadoProjetos } from "./packages/projetos/index.js";
import { projetoPausado } from "./projeto-pausa.js";
import { type FactoryRetroPublication, previewFactoryRetro, publishFactoryRetro } from "./retro-publicacao.js";
import type { RetroSink } from "./retro-sink.js";
import { blockedResumeKind } from "./task-resume.js";
import type { TeamsNotifier } from "./teams-mcp.js";

/** Peças da fábrica que os fluxos humanos (controle, perguntas e decisões) usam. */
export interface DepsFluxosHumanos {
  harness: Harness;
  context: Context;
  readState(): Promise<FactoryState>;
  clock: FactoryClock;
  events: ManagementBridgeDeps["events"];
  eventRecorder: EventRecorder;
  projects: ReadonlyMap<string, ProjetoDaTarefa>;
  projectOf: FiacaoTarefa["projectOf"];
  inspectCard: FiacaoTarefa["inspectCard"];
  canaisDeAviso: Pick<Registro<{ notifier?: TeamsNotifier }, TeamsNotifier>, "create">;
  retroSettings: { repo?: string; sink?: RetroSink };
  teams: TeamsNotifier | undefined;
}

/** Os fluxos humanos montados, com o que o resto da fábrica precisa deles. */
export interface FluxosHumanos {
  controleTarefas: ReturnType<typeof criarControleTarefas>;
  perguntas: ReturnType<typeof criarPerguntas>;
  decisoes: ReturnType<typeof criarDecisoes>;
  alterarEstado: <E, T>(fn: (estado: E) => T) => Promise<T>;
  forwardTechnical(id: string, n: number): Promise<void>;
  markQuestion(id: string, n: number, change: (q: Question) => void): Promise<void>;
}

/**
 * Controle das Tarefas (pausar, retomar, cancelar, vetar), perguntas (conferência, aviso ao Teams, encaminhamento técnico)
 * e decisões humanas (triagem, SPEC, lembrete, pergunta e retrô). As regras estão nos pacotes; aqui a fábrica fornece o
 * estado, o projeto, o Canal e a gravação dos eventos.
 */
export async function montarFluxosHumanos(deps: DepsFluxosHumanos): Promise<FluxosHumanos> {
  const {
    harness,
    context,
    readState,
    clock,
    events,
    eventRecorder,
    projects,
    projectOf,
    inspectCard,
    canaisDeAviso,
    retroSettings,
  } = deps;
  const teams = deps.teams;
  const comoEstadoDaFabrica = (estado: EstadoProjetos) => estado as unknown as FactoryState;
  // --- Controle das Tarefas ---------------------------------------------------------------------
  // Pausar, retomar, cancelar, vetar, pausar o daemon e reordenar: no pacote controle-tarefa. A fábrica fornece o estado,
  // a transação, a execução durável e a classificação do bloqueio.
  const portasControle: PortasControle = {
    // O que sai da transação é cópia feita dentro dela: os rascunhos não podem ser usados depois do commit.
    alterar: (fn) =>
      harness.commit(async (tx) => {
        const resultado = fn((await tx.doc(StateDoc)) as unknown as EstadoControle);
        return typeof resultado === "object" && resultado !== null ? copyOutOfCommit(resultado) : resultado;
      }, context),
    abortar: async (idDurable) => {
      await harness.abortTask(idDurable as TaskId, context);
    },
    agora: () => clock.now(),
    tipoDeBloqueio: (tarefa) => blockedResumeKind(tarefa as unknown as QueuedTask),
  };
  const controleTarefas = criarControleTarefas(portasControle);

  await reinspectPendingVetoes();

  /**
   * Tarefas que já dormiam no prazo de veto quando o daemon subiu (ex.: assumidas antes da ADR-0013): reinspeciona o
   * repositório e, sem trabalho anterior, encerra o prazo agora; a Tarefa acorda, volta à fila e segue para a SPEC.
   */
  async function reinspectPendingVetoes(): Promise<void> {
    await reinspecionarVetos({
      ...portasControle,
      inspecionar: async (tarefa) => {
        const inspecao = await inspectCard(tarefa as unknown as QueuedTask);
        return { kind: inspecao.kind === "seguir" ? "seguir" : "outro" };
      },
      avisarFalha: (id, erro) => console.error(`[fábrica] reinspeção de ${id} falhou; o prazo de veto continua:`, erro),
    });
  }

  // --- Perguntas -------------------------------------------------------------------------------

  /** Encaminhamento comum a respostas locais e ao timer durável da Tarefa. */
  async function forwardTechnical(id: string, n: number): Promise<void> {
    const task = (await readState()).tasks.find((t) => t.id === id);
    if (!task) return;
    const project = projectOf(task.project);
    await encaminharPerguntaTecnica(
      {
        config: project.config,
        channel: project.channel,
        events: eventRecorder,
        now: clock.now,
        commit: (change) => harness.commit(async (tx) => change(await tx.doc(StateDoc)), context),
      },
      id,
      n,
    );
  }

  /** Altera uma pergunta registrada no estado durável. */
  async function markQuestion(id: string, n: number, change: (q: Question) => void): Promise<void> {
    await harness.commit(async (tx) => {
      const question = tarefaDoEstado(await tx.doc(StateDoc), id)?.questions?.find((q) => q.n === n);
      if (question) change(question);
    }, context);
  }

  /** Confere, na Fonte, a resposta de cada Tarefa que aguarda uma pessoa. */
  // --- Perguntas ----------------------------------------------------------------------------------
  // Conferência de respostas pelo Canal e aviso ao Teams: no pacote perguntas. A fábrica fornece o estado, o Canal de
  // cada projeto e a gravação dos eventos.
  const perguntas = criarPerguntas({
    estado: () => readState(),
    alterar: (fn) => harness.commit(async (tx) => fn(await tx.doc(StateDoc)), context),
    agora: () => clock.now(),
    projeto: (nome) => {
      const projeto = projects.get(nome);
      if (!projeto) return undefined;
      return {
        canal: projeto.channel,
        dryRun: projeto.config.dryRun,
        chavesDaFonte: projeto.config.source.keys,
        proximaAtividade: (agora) => nextProjectActivity(projeto.config, agora),
        pessoaPO: (id) => {
          const po = pessoasDoPapel(projeto.config, "po").find((p) => p.id === id);
          return po ? { nome: po.name, identidadeTeams: identidadeTeams(po) } : undefined;
        },
      };
    },
    projetoPausado: (state, nome) => projetoPausado(comoEstadoDaFabrica(state), nome),
    perguntaPendente: (tarefa) => pendingQuestion(tarefa as unknown as QueuedTask),
    registrarResposta: (state, id, n, resposta) =>
      registrarRespostaNoEstado(comoEstadoDaFabrica(state), id, n, resposta),
    avisoTeams: teams
      ? async (userId, texto) => {
          await canaisDeAviso.create("teams", { notifier: teams }).send({ userId, text: texto });
        }
      : undefined,
    registrarEvento: async (evento) => {
      await events.append(evento as NewEvent);
    },
  });

  // --- Decisões humanas --------------------------------------------------------------------------
  // Prévia com revisão e aprovação de triagem, SPEC, lembrete e pergunta ao PO: no pacote decisoes. A fábrica fornece o
  // estado, o projeto (Canal, calendário, Fonte), o aviso ao Teams e a gravação dos eventos.
  /**
   * Transação do estado da fábrica com o tipo que cada pacote declara. É o mesmo commit para todos; só o tipo muda.
   */
  const alterarEstado = <E, T>(fn: (estado: E) => T): Promise<T> =>
    harness.commit(async (tx) => fn((await tx.doc(StateDoc)) as unknown as E), context);

  const decisoes = criarDecisoes({
    estado: () => readState() as unknown as Promise<EstadoDecisoes>,
    alterar: alterarEstado,
    agora: () => clock.now(),
    projeto: (nome) => {
      const projeto = projects.get(nome);
      if (!projeto) return undefined;
      return {
        dryRun: projeto.config.dryRun,
        calendario: projeto.config.calendar,
        baseUrl: projeto.config.source.baseUrl,
        formatMention: (pessoa) => projeto.source.formatMention(pessoa),
        canal: projeto.channel,
        configuracao: projeto.config,
        escritor: projeto.writer,
        pessoaPO: (id) => {
          const po = pessoasDoPapel(projeto.config, "po").find((p) => p.id === id);
          return po ? { nome: po.name, teamsUserId: avisoTeamsDe(po) } : undefined;
        },
      };
    },
    projetoPausado: (estado, nome) => projetoPausado(comoEstadoDaFabrica(estado), nome),
    retro: () => retroSettings,
    // A publicação de retrô é do repositório da fábrica: o pacote só revisa e repassa o texto revisado.
    previsaoRetro: (publicacao) => previewFactoryRetro(publicacao as FactoryRetroPublication),
    publicarRetro: (publicacao, previa) =>
      publishFactoryRetro(
        publicacao as FactoryRetroPublication,
        previa as Awaited<ReturnType<typeof previewFactoryRetro>>,
      ),
    teamsDisponivel: teams !== undefined,
    avisarTeams: (tarefaId, projeto, chave, n) => perguntas.avisarTeams(tarefaId, projeto, chave, n),
    registrarEvento: async (evento) => {
      await events.append(evento as NewEvent);
    },
  });

  return { controleTarefas, perguntas, decisoes, alterarEstado, forwardTechnical, markQuestion };
}
