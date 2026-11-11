import { mkdir, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve as resolvePath } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import {
  createRegistry,
  defineExtension,
  Harness,
  ROOT_CONVERSATION_ID,
  type SetTimer,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { API_SCHEMA } from "./api-schema.js";
import { AvisoLote } from "./aviso-lote.js";
import { type Channel, createCardCommentChannel } from "./channel.js";
import type { CodeHost } from "./code-host.js";
import type { CardState, ProjectConfig } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import type { ImportacaoRepo } from "./durable.js";
import {
  DeadlineGateTask,
  EventEntry,
  eventToJson,
  type FactoryState,
  GateTask,
  type QueuedTask,
  StateDoc,
} from "./durable.js";
import type { EffectWriter } from "./effect-writer.js";
import { tarefaDoEstado } from "./estado-fabrica.js";
import type { EventRecorder, FactoryEvent, NewEvent } from "./events.js";
import { criarCarregadorDeProjetos } from "./factory-carga.js";
import { comandosDeConfiguracao } from "./factory-comandos-config.js";
import { comandosDeTarefa } from "./factory-comandos-tarefa.js";
import { montarEscalonador } from "./factory-escalonador.js";
import { montarFluxosHumanos } from "./factory-fluxos.js";
import { iniciarGestao } from "./factory-gestao.js";
import { criarIntegracaoGitHub } from "./factory-github.js";
import { criarServidorHttp } from "./factory-http.js";
import { montarProjetoDaFabrica } from "./factory-projeto.js";
import { catalogoDeFerramentas } from "./ferramentas-catalogo.js";
import { criarPassosDaTarefa } from "./fiacao-tarefa.js";
import { type CatalogoRepo, catalogoDoApp, createGitHubAppChecker, type GitHubAppPanel } from "./github-app.js";
import { ESQUEMA_FONTE as ESQUEMA_GITHUB, type RawIssue } from "./github-demand-source.js";
import type { InstallationDelivery, IssueDelivery, WebhookEffect } from "./github-webhook.js";
import { ESQUEMA_FONTE as ESQUEMA_GITLAB } from "./gitlab-demand-source.js";
import { createImplementationExtension } from "./implement-stage.js";
import { aplicarImportacao } from "./importacao-issues.js";
import { ESQUEMA_FONTE as ESQUEMA_JIRA } from "./jira-demand-source.js";
import type { ManagementInterface } from "./management.js";
import { criarAcoes, type TarefaAcoes } from "./packages/acoes/index.js";
import { criarRotasApi, type FactoryCommands } from "./packages/api-local/index.js";
import { lerConfiguracao, pendenciasDeConfiguracao, semearConfiguracoes } from "./packages/config-store/index.js";
import { criarConfiguracaoProjetos, type EstadoConfiguracao } from "./packages/configuracao-projeto/index.js";
import { decidirInspecao } from "./packages/controle-tarefa/index.js";
import { criarCredenciais } from "./packages/credenciais/index.js";
import { partesDoId } from "./packages/decisoes/index.js";
import { criarImportacao, type EstadoImportacao, importacoesParaRetomar } from "./packages/importacao/index.js";
import { createIntegrationRegistry, testarConexaoJira } from "./packages/integracoes/index.js";
import {
  HORAS_ATE_LEMBRETE,
  type PortasResposta,
  registrarRespostaNoEstado,
  responderPergunta,
} from "./packages/perguntas/index.js";
import { PERFIS_PRONTOS } from "./packages/profiles/index.js";
import { createProjetos, type EstadoProjetos } from "./packages/projetos/index.js";
import { createSecretStore } from "./packages/secret-store/index.js";
import { criarConfiguracaoTelegram } from "./packages/telegram-config/index.js";
import { findMergedWork } from "./prior-work.js";
import { aguardandoConfirmacao, comConfirmacaoPendente } from "./projeto-fonte.js";
import { projetoPausado } from "./projeto-pausa.js";
import { projetosReservados } from "./projeto-remocao.js";
import { integrateRepair, RepairConflict, repairPreview } from "./repair.js";
import { resolveRepository } from "./repo-resolver.js";
import { ativarProjeto, desativarProjeto, repoDesativado, tarefasAtivas, tarefasEmAndamento } from "./repositorios.js";
import type { RetroSink } from "./retro-sink.js";
import { newTaskRef, RetroExtension } from "./retro-stage.js";
import { createReviewExtension } from "./review-stage.js";
import { redactSecrets } from "./secrets.js";
import { SpecExtension } from "./spec-stage.js";
import { createTarefaTask } from "./tarefa-task.js";
import { taskSummary } from "./task-view.js";
import { createTeamsChannel } from "./teams-canal.js";
import type { TeamsConversation } from "./teams-conversa.js";
import type { TeamsNotifier } from "./teams-mcp.js";
import { createHostTestRunner, type TestRunner } from "./test-runner.js";
import { TriageExtension } from "./triage-modelo.js";
import { startWebhookListener } from "./webhook-listener.js";

export interface FactoryProject {
  config: ProjectConfig;
  source: DemandSource;
  /** Diretório do conhecimento do projeto (`knowledge.md`), fora do repositório (ADR-0010). */
  knowledgeDir?: string;
  /** Remoto de código (descoberta de convenções e push). Padrão: o adaptador git. */
  codeHost?: CodeHost;
}

export interface QueueItem {
  project: string;
  key: string;
  title: string;
  status: string;
  state: CardState;
}

/** Resultado de um veto: aplicado, Tarefa inexistente ou Tarefa que não está (mais) no prazo de veto. */
export type { FactoryCommands, VetoResult } from "./packages/api-local/index.js";

/** Vínculo de um projeto monitorado com o GitHub, como a página e a API o mostram. */
export interface RepoListItem {
  project: string;
  repo: string;
  status: "ativo" | "desativado";
  installationId: number | null;
  motivo: string | null;
}

/** Catálogo de repositórios do App, com o plugue atual de cada um (`GET /github/repos`). */
export interface GitHubReposCatalog {
  configurado: boolean;
  erro?: string;
  consultadoEm: string;
  repos: (CatalogoRepo & {
    plugado: { projeto: string; status: "ativo" | "desativado" } | null;
    importacao: ImportacaoRepo | null;
  })[];
}

export interface RunningFactory {
  url: string;
  /** Os mesmos comandos da API, para as interfaces de gestão no processo do daemon. */
  commands: FactoryCommands;
  /** Entrega `issues` do GitHub já interpretada (ver `parseGitHubDelivery`). O receptor HTTP chama este método. */
  applyGitHubDelivery(delivery: IssueDelivery | InstallationDelivery): Promise<void>;
  /** Repositórios monitorados: vínculo atual de cada um. */
  listRepos(): Promise<RepoListItem[]>;
  plugRepo(repo: string): Promise<{ status: number; body: unknown }>;
  unplugRepo(repo: string, force: boolean): Promise<{ status: number; body: unknown }>;
  /** Painel do GitHub App: receptor, instalações do App e cobertura de cada repositório plugado. */
  githubAppPanel(): Promise<GitHubAppPanel>;
  /** Catálogo dos repositórios que o App acessa, com o plugue atual de cada um. */
  githubReposCatalog(): Promise<GitHubReposCatalog>;
  /** Pede a importação das issues abertas de um repositório do App; responde na hora, a leitura roda na fila. */
  importarRepo(repoId: number): Promise<{ status: number; body: unknown }>;
  /** URL local do receptor do webhook, quando ele está ligado. */
  webhookUrl?: string;
  close(): Promise<void>;
}

/** Estado mais avançado para onde a fábrica move cards no M1. */
const TRANSITION_LIMIT: CardState = "in_progress";

/** Horas úteis sem resposta até o lembrete à pessoa perguntada. */
export const REMINDER_BUSINESS_HOURS = HORAS_ATE_LEMBRETE;

/** Perguntas ao PO numa mesma Tarefa; na seguinte, a Tarefa fica bloqueada para o usuário decidir. */
export const MAX_PO_QUESTIONS = 5;

/** Relógio da fábrica: prazos, sonos do motor e horário dos eventos. Nos testes, um relógio falso. */
export interface FactoryClock {
  now(): number;
  /** Timers do motor e do agendador (ver `HarnessOptions.setTimer`). Sem ele, `setTimeout`. */
  setTimer?: SetTimer;
}

/** Log de eventos durável: cada evento é uma entry na conversa raiz, e os assinantes recebem os novos. */
class DurableEventLog implements EventRecorder {
  private events: FactoryEvent[] = [];
  private subscribers = new Set<(event: FactoryEvent) => void>();

  constructor(
    private harness: Harness,
    private now: () => number,
  ) {}

  async load(): Promise<void> {
    const root = await this.harness.root(context);
    let cursor: Parameters<typeof root.entries>[2];
    do {
      const page = await root.entries({ order: "ascending" }, 500, cursor, context);
      for (const entry of page.items) {
        if (EventEntry.is(entry) && entry.data) this.events.push(entry.data as unknown as FactoryEvent);
      }
      cursor = page.next;
    } while (cursor);
  }

  async append(event: NewEvent): Promise<void> {
    const full = { ...event, at: new Date(this.now()).toISOString() } as FactoryEvent;
    await this.harness.commit(
      (tx) => tx.appendEntry(EventEntry, ROOT_CONVERSATION_ID, { data: eventToJson(full) }),
      context,
    );
    this.events.push(full);
    for (const subscriber of this.subscribers) subscriber(full);
  }

  list(): FactoryEvent[] {
    return [...this.events];
  }

  subscribe(subscriber: (event: FactoryEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
}

/** Se `caminho` existe e é um diretório (fatia 10: caminho de repositório local). */
async function ehDiretorio(caminho: string): Promise<boolean> {
  try {
    return (await stat(caminho)).isDirectory();
  } catch {
    return false;
  }
}

/** Sobe a fábrica: estado durável, agendador da fila única e API local, sempre só em localhost. */
export async function startFactory(opts: {
  projects: FactoryProject[];
  /** Arquivo SQLite do estado durável. */
  statePath: string;
  port?: number;
  /** Intervalo entre buscas automáticas na Fonte. Sem ele, a fábrica só busca via `POST /poll`. */
  pollIntervalMs?: number;
  /** Espera antes de tentar de novo uma Tarefa que falhou. Padrão: 1 minuto. */
  retryDelayMs?: number;
  /** Provedores de modelos (nos testes, o provedor faux). */
  models: Models;
  /** Quem roda o comando de teste dos repositórios. Padrão: direto no host, com ambiente mínimo. */
  testRunner?: TestRunner;
  /** Relógio da fábrica. Padrão: o relógio do sistema. */
  clock?: FactoryClock;
  /** Canal de aviso ao PO; nunca é chamado no dry-run. */
  teams?: TeamsNotifier;
  /** Conversa 1:1 com as pessoas no Teams (canal `teams`, fatia 08). */
  teamsConversation?: TeamsConversation;
  /** Interface de gestão (Telegram) e a conversa/usuário de onde ela aceita comandos. Sem ela, a fábrica só tem a API. */
  management?: { port: ManagementInterface; chat: string; user?: string };
  /**
   * Issues da fábrica (RetroSink) e o repositório **público** da fábrica (`dono/nome`) onde as retrôs abrem issues.
   * Sem `repo`, as propostas da fábrica ficam só registradas na Tarefa.
   */
  retro?: { sink?: RetroSink; repo?: string };
  /**
   * Receptor dos webhooks do GitHub: porta local (um túnel encaminha até ela) e o secret do GitHub App. Sem ele, a
   * fábrica não recebe entregas.
   */
  webhook?: { port: number; secret: string };
  /**
   * App ID e caminho da chave privada do GitHub App, para o painel (só leitura). Sem eles, o painel mostra que o App
   * não está configurado. `fetch` é injetado nos testes.
   */
  githubApp?: { appId?: number; privateKeyPath?: string; fetch?: typeof fetch };
  /**
   * Clona o repositório de um projeto criado pela interface em `destino`. Padrão: clone pelo GitHub App; os testes
   * injetam um clone local.
   */
  clonarRepositorio?: (opts: { repo: string; instalacaoId: number; destino: string }) => Promise<void>;
  /** Clona um repositório GitLab de projeto criado pela interface (padrão: `git` com o token do cofre); os testes injetam. */
  clonarRepositorioGitlab?: (opts: { host: string; caminho: string; token: string; destino: string }) => Promise<void>;
  /** `fetch` da conferência do caminho GitLab com o token (padrão: o global); os testes injetam. */
  fetchGitlab?: typeof fetch;
  /** Cria a interface de gestão do Telegram com o token do cofre (fatia 09). Quem chama escolhe a implementação. */
  criarInterfaceTelegram?: (token: string, chat: string) => ManagementInterface;
  /** `fetch` da checagem de conexão com a Fonte antes de salvar a configuração (padrão: o global). */
  fetchFonte?: typeof fetch;
  /** Cria a Fonte de um projeto de repositório GitHub criado pela UI (o mesmo que o daemon usa para os do YAML). */
  createSource?: (config: ProjectConfig) => DemandSource;
  /** Diretório do conhecimento de um projeto criado pela UI (`knowledge.md`, ADR-0010). */
  knowledgeDirFor?: (name: string) => string;
  /** Agrupamento de avisos em rajada (ver `AvisoLote`). Padrão: 10 s de silêncio. Zero desliga o agrupamento. */
  avisos?: { janelaMs?: number };
}): Promise<RunningFactory> {
  const retryDelayMs = opts.retryDelayMs ?? 60_000;
  const clock: FactoryClock = opts.clock ?? { now: Date.now };
  const appChecker = createGitHubAppChecker({
    appId: opts.githubApp?.appId,
    privateKeyPath: opts.githubApp?.privateKeyPath,
    fetch: opts.githubApp?.fetch,
    now: clock.now,
  });
  /** Um timer do agendador no relógio da fábrica. */
  const armTimer = (callback: () => void, delayMs: number): (() => void) => {
    const disarm = clock.setTimer?.(callback, delayMs, { background: false });
    if (disarm) return disarm;
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  };
  const retroSettings = { ...opts.retro };
  /** Cofre das credenciais (ADR-0018), ao lado do estado durável. Nunca devolve valores pela API. */
  const segredos = createSecretStore({ dir: join(dirname(resolvePath(opts.statePath)), "segredos") });
  // Canais de conversa com as pessoas do projeto, por tipo (ADR-0019). Hoje só existe o comentário no card.
  const rotulosCanais: Record<string, string> = {
    "card-comment": "Comentário no card (perguntas e respostas)",
    teams: "Aviso no Teams",
  };
  const canais = createIntegrationRegistry<
    {
      source: DemandSource;
      writer: EffectWriter;
      conversation?: TeamsConversation;
      personMri?: string;
      dryRun?: boolean;
    },
    Channel
  >("Canal");
  canais.register("card-comment", ({ source, writer }) => createCardCommentChannel({ source, writer }));
  canais.register("teams", ({ conversation, personMri, dryRun }) => {
    if (!conversation || !personMri)
      throw new Error("Teams não configurado: o canal de conversa precisa da conversa e da identidade");
    return createTeamsChannel({ conversation, personMri, dryRun });
  });
  // Canais de aviso (fatia 01): o aviso a uma pessoa é um tipo registrado, como os de conversa. Hoje: o Teams.
  const canaisDeAviso = createIntegrationRegistry<{ notifier?: TeamsNotifier }, TeamsNotifier>("Aviso");
  canaisDeAviso.register("teams", ({ notifier }) => {
    if (!notifier) throw new Error("Teams não configurado: o aviso precisa do notificador");
    return notifier;
  });
  let events!: DurableEventLog;
  const eventRecorder: EventRecorder = { append: (e) => events.append(e), list: () => events.list() };
  /** Monta o que o daemon precisa de um projeto (escritor, canal, código). Usado no startup e ao criar um projeto. */
  function montarProjeto(p: FactoryProject) {
    return montarProjetoDaFabrica(p, {
      eventRecorder,
      readState: () => readState(),
      retroSettings,
      canais,
      transitionLimit: TRANSITION_LIMIT,
      teamsConversation: opts.teamsConversation,
    });
  }
  const projects = new Map(opts.projects.map((p) => [p.config.name, montarProjeto(p)] as const));
  /** Base de cada projeto (Fonte e conhecimento): a configuração muda sem trocar essas peças (ADR-0017). */
  const bases = new Map(opts.projects.map((p) => [p.config.name, p] as const));
  const criadosPelaInterface = new Set<string>();
  const carga = criarCarregadorDeProjetos({
    opts,
    projects,
    bases,
    criadosPelaInterface,
    montarProjeto,
    readState: () => readState(),
  });
  // Os clones da fábrica ficam ao lado do estado durável, nunca na cópia de trabalho do usuário.
  const implementationDeps = {
    worktreesRoot: join(dirname(resolvePath(opts.statePath)), "worktrees"),
    testRunner: opts.testRunner ?? createHostTestRunner(),
    events: eventRecorder,
  };
  const implementationTools = createImplementationExtension(implementationDeps);
  const reviewTools = createReviewExtension(implementationDeps.worktreesRoot);
  const projectOf = (name: string) => {
    const project = projects.get(name);
    if (!project) throw new Error(`Projeto ${name} não está configurado`);
    return project;
  };

  const Tarefa = createTarefaTask(
    criarPassosDaTarefa({
      retryDelayMs,
      clock,
      eventRecorder,
      implementationDeps,
      implementationTools,
      reviewTools,
      projectOf,
      opts,
      get harness() {
        return harness;
      },
      get events() {
        return events;
      },
      get registry() {
        return registry;
      },
      get readState() {
        return readState;
      },
      get forwardTechnical() {
        return forwardTechnical;
      },
      get markQuestion() {
        return markQuestion;
      },
      get perguntas() {
        return perguntas;
      },
      get inspectCard() {
        return inspectCard;
      },
    }),
  );

  /** Inspeção do repositório de um card que já estava em andamento (ADR-0013). */
  async function inspectCard(input: {
    project: string;
    key: string;
  }): Promise<{ kind: "seguir" } | { kind: "bloquear"; reason: string } | { kind: "veto" }> {
    const project = projectOf(input.project);
    const card = await project.source.getCard(input.key);
    const mapping = card && resolveRepository(project.config.repositories, card);
    // A decisão (veto, bloqueio por trabalho já mesclado, ou seguir) está no pacote controle-tarefa.
    return decidirInspecao({
      key: input.key,
      temRepositorio: Boolean(mapping),
      trabalhoMesclado: mapping ? await findMergedWork(resolvePath(mapping.path), input.key) : null,
    });
  }

  const registry = createRegistry();
  registry.install(defineExtension({ name: "fabrica", tasks: [Tarefa, GateTask, DeadlineGateTask] }));
  registry.install(SpecExtension);
  registry.install(TriageExtension);
  registry.install(RetroExtension);
  registry.install(implementationTools.extension);
  registry.install(reviewTools.extension);
  await mkdir(dirname(opts.statePath), { recursive: true });
  const harness = await Harness.open(
    await openNodeSqliteStorage(opts.statePath),
    {
      now: clock.now,
      setTimer: clock.setTimer,
      models: opts.models,
      registry,
      onReport: (report) => console.error(`[fábrica] ${report.kind}:`, report.error),
    },
    context,
  );
  await harness.root(context);
  events = new DurableEventLog(harness, clock.now);
  await events.load();
  const initialEventCount = events.list().length;

  const readState = async (): Promise<FactoryState> =>
    (await harness.snapshot(StateDoc, context)) ?? { daemonPaused: false, tasks: [] };

  /** Projetos criados pela UI (ADR-0022). Só eles são barrados enquanto incompletos; os do YAML seguem como estão. */
  /** Pendências que barram ações: as de um projeto criado pela UI, e a confirmação de uma troca de Fonte (ticket 10). */
  const pendenciasBloqueantes = (nome: string, state: FactoryState): string[] =>
    comConfirmacaoPendente(
      criadosPelaInterface.has(nome) ? pendenciasDeConfiguracao(projectOf(nome).config) : [],
      state,
      nome,
    );

  /** Registra um projeto criado pela UI no processo, com a Fonte e o conhecimento do mesmo jeito que os do YAML. */
  /** O estado da fábrica tem os campos que o módulo usa; as regras leem os mesmos objetos, sem cópia. */
  const comoEstadoDaFabrica = (estado: EstadoProjetos) => estado as unknown as FactoryState;
  /**
   * Módulo de Projetos (ciclo de vida de um Projeto): as portas são as dependências reais deste processo. O módulo só
   * conhece a parte do estado que usa; o estado completo da fábrica entra como ele mesmo.
   */
  const projetos = createProjetos({
    criacaoHabilitada: opts.createSource !== undefined,
    padrao: (opts.projects.find((p) => p.config.source.type === "github") ?? opts.projects[0])?.config,
    caminhoDoClone: (nome) => join(dirname(resolvePath(opts.statePath)), "repositorios", nome),
    segredos,
    github: appChecker,
    estado: {
      ler: readState,
      alterar: (fn) => harness.commit(async (tx) => fn(await tx.doc(StateDoc)), context),
    },
    registrar: carga.registrarProjeto,
    projetosAtivos: () => [...projects.values()].map((p) => p.config),
    agora: () => clock.now(),
    fetchFonte: opts.fetchFonte,
    fetchGitlab: opts.fetchGitlab,
    clonarGithub: opts.clonarRepositorio,
    clonarGitlab: opts.clonarRepositorioGitlab,
    projetoDoRepositorio: (repo) => projectByRepo(repo),
    pendenciasBloqueantes: (nome, state) => pendenciasBloqueantes(nome, comoEstadoDaFabrica(state)),
    importacao: { enfileirar: (repoId) => importacao.enfileirar(repoId) },
    efeitos: { executar: (efeitos) => runWebhookEffects(efeitos as WebhookEffect[]) },
    regras: {
      projetosReservados: (s) => projetosReservados(comoEstadoDaFabrica(s)),
      repoDesativado: (s, p) => repoDesativado(comoEstadoDaFabrica(s), p),
      projetoPausado: (s, p) => projetoPausado(comoEstadoDaFabrica(s), p),
      tarefasAtivas: (s, p) => tarefasAtivas(comoEstadoDaFabrica(s), p),
      tarefasEmAndamento: (s, p) => tarefasEmAndamento(comoEstadoDaFabrica(s), p),
      ativarProjeto: (opts) => ativarProjeto({ ...opts, state: comoEstadoDaFabrica(opts.state) }),
      desativarProjeto: (opts) => desativarProjeto({ ...opts, state: comoEstadoDaFabrica(opts.state) }),
      aguardandoConfirmacao: (s, p) => aguardandoConfirmacao(comoEstadoDaFabrica(s), p),
      comConfirmacaoPendente: (pendencias, s, p) => comConfirmacaoPendente(pendencias, comoEstadoDaFabrica(s), p),
    },
    fabrica: {
      esquecer: (nome) => {
        projects.delete(nome);
        bases.delete(nome);
        criadosPelaInterface.delete(nome);
      },
    },
  });

  // ADR-0017: o YAML só semeia o estado; depois da primeira execução, a configuração guardada é a que vale.
  await harness.commit(async (tx) => {
    const state = await tx.doc(StateDoc);
    // Projeto removido pela interface (ticket 11) não volta do YAML: o nome fica reservado.
    const removidos = state.projetosRemovidos ?? {};
    state.projetos = semearConfiguracoes(
      state.projetos ?? {},
      opts.projects.map((p) => p.config).filter((config) => !(config.name in removidos)),
    );
  }, context);
  await carga.carregarSalvos();
  retroSettings.repo = (await readState()).retroRepo ?? retroSettings.repo;
  if (!retroSettings.repo)
    console.warn(
      "[fábrica] Configure o repositório das retrôs em Configurar publicações na web; nenhuma issue será publicada sem aprovação.",
    );
  // Controle, perguntas e decisões humanas: no módulo factory-fluxos.
  const fluxos = await montarFluxosHumanos({
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
    teams: opts.teams,
  });
  const { controleTarefas, perguntas, decisoes, alterarEstado, forwardTechnical, markQuestion } = fluxos;

  const { escalonador, filaElegivel } = await montarEscalonador({
    harness,
    context,
    Tarefa,
    projects,
    readState,
    events,
    clock,
    armTimer,
    perguntas,
    reconcileRepos: () => reconcileRepos(),
    pendenciasBloqueantes,
  });
  const observation = harness.observeCommits({
    advance: () => queueMicrotask(() => escalonador.pedirReacao()),
    end: () => undefined,
  });
  harness.resume();
  escalonador.pedirReacao();

  // --- Comandos ----------------------------------------------------------------------------------

  /** Avisos ao usuário: uma rajada vira um resumo por projeto e motivo, em vez de um aviso por card (ver `AvisoLote`). */
  const avisos = new AvisoLote({
    janelaMs: opts.avisos?.janelaMs ?? 10_000,
    now: () => clock.now(),
    armTimer,
    emit: (aviso) =>
      events.append({
        type: "notify",
        project: aviso.project,
        target: aviso.target,
        reason: aviso.reason,
        message: aviso.message,
      }),
  });

  /** Projetos monitorados como os reducers do webhook os veem. */
  // Integração com o GitHub (webhook, reconciliação e leituras de repositório): no módulo factory-github.
  const integracao = criarIntegracaoGitHub({
    projects,
    readState,
    alterar: alterarEstado,
    clock,
    harness,
    context,
    avisos,
    appChecker,
    webhook: opts.webhook,
  });
  const {
    webhookProjects,
    runWebhookEffects,
    reconcileRepos,
    applyGitHubDelivery,
    projectByRepo,
    listRepos,
    githubReposCatalog,
    githubAppPanel,
  } = integracao;

  // --- Importação do GitHub App --------------------------------------------------------------------
  // Fila e execução das importações de repositórios: no pacote importacao. A fábrica fornece o App, o catálogo, as
  // issues abertas, a aplicação no estado (importacao-issues) e a execução dos efeitos.
  const importacao = criarImportacao<RawIssue, WebhookEffect>({
    estado: () => readState() as unknown as Promise<EstadoImportacao>,
    alterar: alterarEstado,
    agora: () => clock.now(),
    statusDoApp: async () => {
      const app = await appChecker.status();
      return { configurado: app.configurado, erro: app.erro };
    },
    repoDoApp: async (repoId) => {
      const app = await appChecker.status();
      return catalogoDoApp(app).find((r) => r.id === repoId);
    },
    projetoDoRepo: (nome) => projectByRepo(nome),
    issuesAbertas: (nome, instalacaoId) => appChecker.issuesAbertas(nome, instalacaoId),
    aplicar: (estado, alvo) => {
      const projeto = webhookProjects().find((p) => p.name === alvo.projeto);
      if (!projeto) throw new Error(`projeto ${alvo.projeto} não está carregado`);
      const aplicado = aplicarImportacao({
        state: estado as unknown as FactoryState,
        project: projeto,
        repoId: alvo.repoId,
        repo: alvo.repo,
        installationId: alvo.instalacaoId,
        issues: alvo.issues,
        newRef: newTaskRef,
      });
      return { resultado: aplicado.resultado, efeitos: aplicado.effects };
    },
    executarEfeitos: (efeitos) => runWebhookEffects(efeitos),
    redigir: (texto) => redactSecrets(texto),
  });

  // --- Ações humanas sobre a Tarefa -------------------------------------------------------------
  // Esquecer a memória de uma etapa e reparo humano de Tarefa bloqueada: no pacote acoes. A fábrica fornece o estado, a
  // transação, a integração do reparo (com o test runner) e o progresso.
  const acoes = criarAcoes({
    tarefa: async (id) => (await readState()).tasks.find((t) => t.id === id) as unknown as TarefaAcoes | undefined,
    alterar: (id, fn) =>
      harness.commit(async (tx) => {
        const alvo = tarefaDoEstado(await tx.doc(StateDoc), id);
        if (alvo) fn(alvo as unknown as TarefaAcoes);
      }, context),
    previaReparo: (tarefa) => repairPreview(tarefa as unknown as QueuedTask, implementationDeps.worktreesRoot),
    integrarReparo: (id, revisao) =>
      harness.commit(async (tx) => {
        const current = tarefaDoEstado(await tx.doc(StateDoc), id);
        if (!current) throw new RepairConflict("tarefa inexistente");
        return integrateRepair(
          current as QueuedTask,
          implementationDeps.worktreesRoot,
          revisao,
          implementationDeps.testRunner,
          context.abortSignal,
        );
      }, context),
    registrarProgresso: async (id, mensagem) => {
      const { projectName, cardKey } = partesDoId(id);
      await events.append({ type: "progress", project: projectName, target: cardKey, message: mensagem });
    },
  });

  // --- Configuração de projetos ------------------------------------------------------------------
  // Leitura, confirmação da Fonte, histórico e salvamento da configuração: no pacote configuracao-projeto. A fábrica
  // fornece o estado, a transação, o sistema de arquivos, a checagem da Fonte e a aplicação aos projetos carregados.
  const configProjetos = criarConfiguracaoProjetos({
    estado: () => readState() as unknown as Promise<EstadoConfiguracao>,
    alterar: alterarEstado,
    agora: () => clock.now(),
    tarefasEmAndamento: (estado, nome) => tarefasEmAndamento(estado as unknown as FactoryState, nome).map((t) => t.id),
    ehDiretorio,
    erroDaFonte: (fonte) => projetos.erroDaFonte(fonte),
    aplicar: (config) => {
      carga.aplicarConfiguracao(config);
    },
  });

  // --- Respostas às perguntas --------------------------------------------------------------------
  // Validação, mapeamento de repositório, encaminhamento de "não sei" e registro da resposta: no pacote perguntas. A
  // fábrica fornece o estado, os repositórios do projeto, o registro na Tarefa, os eventos e o encaminhamento técnico.
  const respostas: PortasResposta = {
    alterar: alterarEstado,
    repositoriosDoProjeto: (projeto) => projectOf(projeto).config.repositories,
    registrarResposta: (estado, id, n, resposta) =>
      registrarRespostaNoEstado(estado as unknown as FactoryState, id, n, resposta),
    registrarEvento: async (evento) => {
      await events.append(evento as NewEvent);
    },
    encaminharTecnica: (id, n) => forwardTechnical(id, n),
    pedirReacao: () => escalonador.pedirReacao(),
  };

  // --- Configuração do Telegram ------------------------------------------------------------------
  // Conversa do bot, usuário autorizado e credencial do token: no pacote telegram-config. A fábrica fornece o estado, o
  // cofre e o reinício da interface.
  const telegramConfig = criarConfiguracaoTelegram({
    guardada: async () => (await readState()).telegramConfig,
    gravar: (configuracao) =>
      harness.commit(async (tx) => {
        (await tx.doc(StateDoc)).telegramConfig = configuracao;
      }, context),
    credencialCadastrada: (nome) => segredos.has(nome),
    reiniciar: () => gestao.reiniciar(),
  });

  // --- Cofre de credenciais ----------------------------------------------------------------------
  // Troca de credencial com as regras de uso por projetos: no pacote credenciais. A fábrica fornece a configuração, o
  // cofre, o teste de conexão do Jira, o reinício do Telegram e o histórico.
  const credenciais = criarCredenciais({
    projetos: async () =>
      Object.entries((await readState()).projetos ?? {}).flatMap(([nomeProjeto, bruto]) => {
        const config = lerConfiguracao(bruto);
        return config ? [{ nome: nomeProjeto, credencial: config.source.credential, fonte: config.source }] : [];
      }),
    testarConexaoJira: (conexao, valor) =>
      testarConexaoJira({ ...conexao, token: valor, fetch: opts.fetchFonte ?? fetch }),
    guardar: (nome, valor) => segredos.put(nome, valor),
    telegramUsa: async (nome) => (await readState()).telegramConfig?.credential === nome,
    reiniciarTelegram: () => gestao.reiniciar(),
    registrarTroca: async (projetos, nome) => {
      await harness.commit(async (tx) => {
        const state = await tx.doc(StateDoc);
        const quando = new Date(clock.now()).toISOString();
        const historico = { ...state.historicoConfig };
        for (const projeto of projetos)
          historico[projeto] = [
            ...(historico[projeto] ?? []),
            { quando, autor: "usuario", campos: [`credencial ${nome} trocada`] },
          ];
        state.historicoConfig = historico;
      }, context);
    },
  });

  const commands: FactoryCommands = {
    answerQuestion: (id, n, answer) => responderPergunta(respostas, id, n, answer),
    // Controle das Tarefas pelo usuário: no pacote controle-tarefa.
    pause: (id: string) => controleTarefas.pausar(id),
    resume: (id: string) => controleTarefas.retomar(id),
    cancel: (id: string) => controleTarefas.cancelar(id),
    veto: (id: string) => controleTarefas.vetar(id),
    pausarProjeto: (nome: string) => projetos.marcarPausa(nome, true),
    retomarProjeto: (nome: string) => projetos.marcarPausa(nome, false),
    setDaemonPaused: (paused: boolean) => controleTarefas.pausarDaemon(paused),
    reorder: (ids: string[]) => controleTarefas.reordenar(ids),
    // Consultas da API local.
    daemonPausado: async () => (await readState()).daemonPaused,
    fila: () => filaElegivel(),
    tarefas: async () => (await readState()).tasks.map(taskSummary),
    eventos: () => events.list(),
    eventosFluxo: () => ({
      tipo: "fluxo" as const,
      assinar: (enviar) => events.subscribe((event) => enviar(JSON.stringify(event))),
    }),
    ferramentas: () => catalogoDeFerramentas(),
    esquema: () => API_SCHEMA,
    projetosCarregados: () =>
      [...projects.values()].map((p) => ({
        nome: p.config.name,
        fonte: p.config.source.type,
        ensaio: p.config.dryRun,
      })),
    canais: () => [
      ...canais.tipos().map((tipo) => ({ tipo, papel: "conversa", rotulo: rotulosCanais[tipo] ?? tipo })),
      ...canaisDeAviso.tipos().map((tipo) => ({ tipo, papel: "aviso", rotulo: rotulosCanais[tipo] ?? tipo })),
    ],
    integracoesFontes: () => [ESQUEMA_JIRA, ESQUEMA_GITHUB, ESQUEMA_GITLAB],
    perfisProntos: () => PERFIS_PRONTOS,
    repos: () => listRepos(),
    githubApp: () => githubAppPanel(),
    githubRepos: () => githubReposCatalog(),
    projetos,

    ...comandosDeTarefa({
      lerEstado: readState,
      harness,
      context,
      events,
      responder: (id, n, texto) => responderPergunta(respostas, id, n, texto),
      decisoes,
      acoes,
    }),
    poll: async () => {
      await escalonador.pedirBusca();
      return { status: 200, body: { ok: true } };
    },
    ...comandosDeConfiguracao({
      configProjetos,
      segredos,
      credenciais,
      telegramConfig,
      decisoes,
      harness,
      context,
      retroSettings,
    }),
  };

  // --- API HTTP: servidor local no módulo factory-http ----------------------------------------------
  const { server, streams } = criarServidorHttp({ rotas: criarRotasApi(commands) });

  // Sincronização de startup (ADR-0015): recupera o que o webhook perdeu enquanto o daemon esteve fora.
  void escalonador
    .sincronizar(reconcileRepos)
    .catch((err) => console.error("[fábrica] sincronização de startup falhou:", redactSecrets(String(err))));
  // Importações que o daemon deixou em `importando` (ele caiu no meio) voltam para a fila; a escrita é uma só, então
  // rodar de novo não duplica nada.
  void readState()
    .then((state) => {
      for (const repoId of importacoesParaRetomar(state.importacoes)) importacao.enfileirar(repoId);
    })
    .catch((err) => console.error("[fábrica] retomada das importações falhou:", redactSecrets(String(err))));
  // O timer pula o tick se ainda houver busca pendente, para não acumular buscas com a Fonte lenta.
  const pollTimer = opts.pollIntervalMs && setInterval(() => escalonador.pedirBuscaPeriodica(), opts.pollIntervalMs);

  // Interface de gestão (Telegram): no módulo factory-gestao.
  const gestao = await iniciarGestao({
    management: opts.management,
    criarInterfaceTelegram: opts.criarInterfaceTelegram,
    segredos,
    readState,
    harness,
    context,
    events,
    initialEventCount,
    projects,
    clock,
    armTimer,
    commands,
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  // Receptor do webhook: só entrega issues já validadas pela assinatura; a aplicação é `applyGitHubIssue`.
  const webhookListener = opts.webhook
    ? await startWebhookListener({
        port: opts.webhook.port,
        secret: opts.webhook.secret,
        onIssues: applyGitHubDelivery,
        onInstallation: applyGitHubDelivery,
      })
    : undefined;
  return {
    url: `http://127.0.0.1:${port}`,
    webhookUrl: webhookListener?.url,
    commands,
    applyGitHubDelivery,
    listRepos,
    plugRepo: (repo) => projetos.plugarRepo(repo),
    unplugRepo: (repo, force) => projetos.desplugarRepo(repo, force),
    githubAppPanel,
    githubReposCatalog,
    importarRepo: (repoId) => projetos.importarRepo(repoId),
    close: async () => {
      escalonador.parar();
      await avisos.flush();
      await gestao.parar();
      await webhookListener?.close();
      if (pollTimer) clearInterval(pollTimer);
      for (const stream of streams) stream.end();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await escalonador.ociosa();
      observation.detach();
      await harness.close(context);
    },
  };
}
