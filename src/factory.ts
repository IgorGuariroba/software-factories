import { mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve as resolvePath } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import {
  type ConversationId,
  createRegistry,
  defineExtension,
  Harness,
  ROOT_CONVERSATION_ID,
  type SetTimer,
  type TaskId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { resolverAgenteDaEtapa } from "./agente-etapa-config.js";
import { API_SCHEMA } from "./api-schema.js";
import { AvisoLote } from "./aviso-lote.js";
import { synchronizeBase } from "./base-sync.js";
import { addBusinessHours, nextProjectActivity, workdayHours } from "./business-hours.js";
import { type Channel, createCardCommentChannel, createPersonChannel } from "./channel.js";
import type { CodeHost } from "./code-host.js";
import { type CardState, ProjectConfig } from "./config.js";
import { runDelivery } from "./delivery-stage.js";
import type { DemandSource } from "./demand-source.js";
import { validarDestinatarioDoProjeto } from "./destinatarios-projeto.js";
import type { ImportacaoRepo } from "./durable.js";
import {
  copyOutOfCommit,
  createTarefaTask,
  DeadlineGateTask,
  EventEntry,
  eventToJson,
  type FactoryState,
  GateTask,
  InspectionBlocked,
  ManagementDoc,
  pendingQuestion,
  type Question,
  type QueuedTask,
  RETRO_STEP,
  type RetroStage,
  recordAnswer,
  StateDoc,
  type TriageRecord,
} from "./durable.js";
import { createEffectWriter, type EffectWriter, GuardrailViolation, withAutomationMark } from "./effect-writer.js";
import { encaminharPerguntaTecnica, prazoPerguntaTecnica } from "./encaminhamento-tecnico.js";
import type { EventRecorder, FactoryEvent, NewEvent } from "./events.js";
import { catalogoDeFerramentas } from "./ferramentas-catalogo.js";
import { defaultBranch, git } from "./git.js";
import { gitCodeHost } from "./git-code-host.js";
import {
  type CatalogoRepo,
  catalogoDoApp,
  cobertura,
  createGitHubAppChecker,
  type GitHubAppPanel,
} from "./github-app.js";
import { ESQUEMA_FONTE as ESQUEMA_GITHUB } from "./github-demand-source.js";
import {
  applyInstallationDelivery as applyInstallationToState,
  applyIssueDelivery as applyToState,
  type InstallationDelivery,
  type IssueDelivery,
  reconciliarIssues,
  type WebhookEffect,
  type WebhookProject,
} from "./github-webhook.js";
import { ESQUEMA_FONTE as ESQUEMA_GITLAB } from "./gitlab-demand-source.js";
import {
  clonarRepositorioGitlab,
  hostDoServidor,
  SERVIDOR_PADRAO,
  verificarRepositorioGitlab,
} from "./gitlab-repositorio.js";
import { createImplementationExtension, runImplementation, StageBlocked } from "./implement-stage.js";
import { aplicarImportacao } from "./importacao-issues.js";
import { ESQUEMA_FONTE as ESQUEMA_JIRA } from "./jira-demand-source.js";
import { type ManagementInterface, startManagementBridge } from "./management.js";
import { ferramentasMcpDaEtapa } from "./mcp-etapa.js";
import {
  camposAlterados,
  estadoDoProjeto,
  lerConfiguracao,
  pendenciasDeConfiguracao,
  semearConfiguracoes,
} from "./packages/config-store/index.js";
import { createIntegrationRegistry, testarConexaoJira } from "./packages/integracoes/index.js";
import {
  avisoTeamsDe,
  canalDaPessoa,
  identidadeTeams,
  PERFIS_PRONTOS,
  pessoasDoPapel,
  proximaPessoaDoPapel,
  validarPerfis,
} from "./packages/profiles/index.js";
import { createSecretStore } from "./packages/secret-store/index.js";
import {
  conferirEscolhasPessoas,
  type EscolhasPessoas,
  listarPessoasGitlab,
  listarPessoasJira,
  type PessoaDaFonte,
  pessoasDeAssignees,
} from "./pessoas-fonte.js";
import { findClosingCommit, findMergedWork, recentSubjects } from "./prior-work.js";
import { aguardandoConfirmacao, comConfirmacaoPendente, trocouFonteOuRepositorio } from "./projeto-fonte.js";
import { projetoPausado } from "./projeto-pausa.js";
import { projetosReservados, semProjeto } from "./projeto-remocao.js";
import {
  conflitoProjeto,
  montarProjetoGithub,
  padroesDe,
  pessoasDoProjeto,
  type ReservaDeProjeto,
} from "./projetos-github.js";
import { questionRevision, reviewRevision, teamsQuestionMessage } from "./question-review.js";
import { integrateRepair, RepairConflict, repairPreview } from "./repair.js";
import { repositoryFromAnswer, repositoryQuestion, resolveRepository } from "./repo-resolver.js";
import { ativarProjeto, desativarProjeto, repoDesativado, tarefasAtivas, tarefasEmAndamento } from "./repositorios.js";
import { respostaNaoSei } from "./resposta-tecnica.js";
import { isRetroRepository } from "./retro-settings.js";
import type { RetroSink } from "./retro-sink.js";
import { newTaskRef, previewFactoryRetro, publishFactoryRetro, RetroExtension, runRetro } from "./retro-stage.js";
import { createReviewExtension, runReview } from "./review-stage.js";
import { redactSecrets } from "./secrets.js";
import {
  answerFollowUp,
  isShallowCard,
  renderTickets,
  requestSpec,
  SHALLOW_CARD_QUESTION,
  type SpecDelivery,
  SpecExtension,
  specInput,
} from "./spec-stage.js";
import { blockedResumeKind } from "./task-resume.js";
import { taskDetail, taskEvents, taskSummary } from "./task-view.js";
import { createTeamsChannel } from "./teams-canal.js";
import type { TeamsConversation } from "./teams-conversa.js";
import type { TeamsNotifier } from "./teams-mcp.js";
import { createHostTestRunner, type TestRunner } from "./test-runner.js";
import { conversasDaTarefa, traceDaTarefa } from "./trace-tarefa.js";
import {
  classifyTriage,
  deterministicTriage,
  refusalComment,
  requestTriage,
  TriageExtension,
  type TriageResult,
  triageInput,
  trustedContext,
} from "./triage.js";
import { webFile } from "./web.js";
import { startWebhookListener } from "./webhook-listener.js";

export interface FactoryProject {
  config: ProjectConfig;
  source: DemandSource;
  /** Diretório do conhecimento do projeto (`knowledge.md`), fora do repositório (ADR-0010). */
  knowledgeDir?: string;
  /** Remoto de código (descoberta de convenções e push). Padrão: o adaptador git. */
  codeHost?: CodeHost;
}

/** Lê o conhecimento do projeto a cada etapa; sem o arquivo, a etapa segue sem ele. */
async function readKnowledge(dir: string | undefined): Promise<string | undefined> {
  if (!dir) return undefined;
  try {
    return await readFile(join(dir, "knowledge.md"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export interface QueueItem {
  project: string;
  key: string;
  title: string;
  status: string;
  state: CardState;
}

/** Resultado de um veto: aplicado, Tarefa inexistente ou Tarefa que não está (mais) no prazo de veto. */
export type VetoResult = "vetada" | "inexistente" | "fora-do-prazo";

/** Comandos do usuário sobre a fábrica; a API e as interfaces de gestão (Telegram, web) chamam os mesmos. */
export interface FactoryCommands {
  /** Retornam `false` se a Tarefa não existe. */
  pause(id: string): Promise<boolean>;
  resume(id: string): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
  /** Veta, dentro do prazo, a Tarefa de um card que já estava em andamento: ela fica `vetada` e não age mais no card. */
  veto(id: string): Promise<VetoResult>;
  setDaemonPaused(paused: boolean): Promise<void>;
  /** Pausa um projeto ativo (ticket 09): nada novo começa nele até a retomada. */
  pausarProjeto(nome: string): Promise<void>;
  /** Retoma um projeto pausado; as Tarefas que a pausa parou voltam para a fila. */
  retomarProjeto(nome: string): Promise<void>;
  reorder(ids: string[]): Promise<void>;
  /** Responde localmente sem publicar na Fonte; false se a pergunta não está disponível. */
  answerQuestion?(id: string, n: number, answer: string): Promise<boolean>;
}

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

/** Estados em que a fábrica assume um card. */
const ELIGIBLE: ReadonlySet<CardState> = new Set(["todo", "in_progress"]);

/** Quantas entregas do webhook a fábrica lembra para não reaplicar reenvios (ver `FactoryState.deliveries`). */
const DELIVERY_MEMORY = 1000;

/** Estado mais avançado para onde a fábrica move cards no M1. */
const TRANSITION_LIMIT: CardState = "in_progress";

/** Texto do lembrete de uma pergunta sem resposta. */
const reminderText = (q: Question) => `Lembrete da pergunta ${q.n}: ainda aguardo a sua resposta neste card. ${q.text}`;

/** Horas úteis sem resposta até o lembrete à pessoa perguntada. */
export const REMINDER_BUSINESS_HOURS = 4;

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

/** O relato que o modelo da retrô recebe: o que aconteceu na etapa (ou, na consolidada, as retrôs das etapas). */
function retroInput(stage: RetroStage, task: QueuedTask, all: FactoryEvent[]): string {
  const incidents = taskEvents(task, all)
    .filter((e) => e.type === "error" || e.type === "blocked")
    .map((e) => (e.type === "error" ? `- erro: ${e.message}` : e.type === "blocked" ? `- barrada: ${e.reason}` : ""));
  const questions = task.questions ?? [];
  const common = [
    `Tentativas da Tarefa depois de falhas: ${task.attempts}.`,
    `Perguntas ao PO: ${questions.length}.`,
    ...questions.map((q) => `- pergunta ${q.n} (${q.origin}): ${q.text}`),
    `Incidentes registrados: ${incidents.length}.`,
    ...incidents,
  ];
  if (stage === "spec")
    return [
      "# Retrô da etapa SPEC (grill → SPEC → Tickets)",
      ...common,
      "## SPEC entregue",
      task.delivery?.spec ?? "(nenhuma)",
      `## Tickets (${task.delivery?.tickets.length ?? 0})`,
      ...(task.delivery?.tickets ?? []).map((t, i) => `${i + 1}. ${t.titulo}: ${t.aceite}`),
    ].join("\n");
  if (stage === "implementacao") {
    const impl = task.implementation;
    const commits = impl?.commits ?? [];
    return [
      "# Retrô da etapa de implementação (TDD ticket a ticket)",
      ...common,
      `Pedidos ao implementador: ${impl?.requests ?? 0}; commits aceitos: ${commits.length}; ` +
        `pedidos recusados ou sem resposta: ${Math.max(0, (impl?.requests ?? 0) - commits.length)}.`,
      ...commits.map((c) => `- ticket ${c.ticket + 1}, fase ${c.phase}`),
      `Push da branch: ${impl?.pushed ? "feito" : "não feito"}.`,
    ].join("\n");
  }
  if (stage === "triagem" || stage === "review" || stage === "mr")
    return [
      `# Retrô da etapa ${stage}`,
      ...common,
      JSON.stringify(stage === "triagem" ? task.triage : stage === "review" ? task.review : task.publication),
    ].join("\n");
  const retros = (task.retros ?? []).filter((r) => r.stage !== "tarefa");
  return [
    "# Retrô consolidada da Tarefa",
    ...common,
    "## Retrôs das etapas",
    ...retros.flatMap((r) => [
      `### ${r.stage} (${r.status})`,
      r.summary ?? "(sem resumo)",
      ...(r.proposals ?? []).map((p) => `- [${p.kind}] ${p.title}: ${p.description}`),
    ]),
  ].join("\n");
}

/** Sobe a fábrica: estado durável, agendador da fila única e API local, sempre só em localhost. */
/** Se `caminho` existe e é um diretório (fatia 10: caminho de repositório local). */
async function ehDiretorio(caminho: string): Promise<boolean> {
  try {
    return (await stat(caminho)).isDirectory();
  } catch {
    return false;
  }
}

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
    // Execução e SLAs usam o mesmo calendário efetivo, inclusive feriados legais.
    if (p.config.activity === "business-hours") {
      p = { ...p, config: { ...p.config, calendar: { ...p.config.calendar, legalHolidays: true } } };
    }
    const codeHost = p.codeHost ?? gitCodeHost;
    const writer: EffectWriter = createEffectWriter({
      ...p,
      events: eventRecorder,
      transitionLimit: TRANSITION_LIMIT,
      codeHost,
      // Branch da fábrica é a que ela criou, registrada no estado durável de uma Tarefa deste projeto; não um padrão
      // de nome, nem uma branch adotada do remoto (que pode ser de uma pessoa).
      isFactoryBranch: async (branch) =>
        (await readState()).tasks.some(
          (t) =>
            t.project === p.config.name &&
            t.implementation?.branch === branch &&
            t.implementation.branchOrigin === "criada",
        ),
      isReviewedBranch: async (cardKey, cwd, draft) => {
        const task = (await readState()).tasks.find((t) => t.project === p.config.name && t.key === cardKey);
        const progress = task?.implementation;
        if (
          !progress ||
          (await realpath(progress.worktree).catch(() => null)) !== cwd ||
          progress.branch !== draft.branch ||
          task.review?.status !== "aprovado"
        )
          return false;
        if (p.config.specApproval && (task.specReview !== "approved" || task.specApprovedDryRun !== p.config.dryRun))
          return false;
        const base = progress.defaultBranch ?? (await defaultBranch(cwd));
        return (
          draft.base === base &&
          (await git(cwd, ["rev-parse", "HEAD"])).trim() === task.review.head &&
          task.review.head === progress.head
        );
      },
      retro: retroSettings,
    });
    const pessoaDe = (personId: string) => p.config.people.find((x) => x.id === personId);
    const padrao = canais.create("card-comment", { source: p.source, writer });
    const channel: Channel = createPersonChannel({
      padrao,
      escolheTeams: (personId) => {
        const pessoa = pessoaDe(personId);
        return pessoa !== undefined && canalDaPessoa(pessoa) === "teams";
      },
      teamsDe: (personId) => {
        const pessoa = pessoaDe(personId);
        const personMri = pessoa && identidadeTeams(pessoa);
        if (!pessoa || !personMri || !opts.teamsConversation) return undefined;
        return canais.create("teams", {
          source: p.source,
          writer,
          conversation: opts.teamsConversation,
          personMri,
          dryRun: p.config.dryRun,
        });
      },
    });
    return { ...p, codeHost, writer, channel };
  }
  const projects = new Map(opts.projects.map((p) => [p.config.name, montarProjeto(p)] as const));
  /** Base de cada projeto (Fonte e conhecimento): a configuração muda sem trocar essas peças (ADR-0017). */
  const bases = new Map(opts.projects.map((p) => [p.config.name, p] as const));
  /** Troca a configuração de um projeto carregado, mantendo a Fonte e o conhecimento dele. */
  function aplicarConfiguracao(config: ProjectConfig): boolean {
    const base = bases.get(config.name);
    if (!base) return false;
    // Trocar o tipo da Fonte cria a Fonte nova; mudar só os campos mantém a que já existe.
    const trocouTipo = base.config.source.type !== config.source.type && opts.createSource;
    const nova: FactoryProject = trocouTipo
      ? { ...base, config, source: opts.createSource?.(config) ?? base.source }
      : { ...base, config };
    bases.set(config.name, nova);
    projects.set(config.name, montarProjeto(nova));
    return true;
  }
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

  const Tarefa = createTarefaTask({
    retryDelayMs,
    availableAt(input) {
      const config = projectOf(input.project).config;
      return nextProjectActivity(config, clock.now());
    },
    async run(input, step, runtime) {
      const project = projectOf(input.project);
      const { writer, source } = project;
      if (step === "triar") return triage();
      if (step === "comentar") {
        if (project.config.announceAssume) await writer.commentOnce(input.key, "Assumindo este card.");
        // Uma nova tentativa recomeça deste passo; o aviso de que assumiu sai uma vez só.
        const announced = events
          .list()
          .some((e) => e.type === "assumed" && e.project === input.project && e.target === input.key);
        if (!announced) {
          let task: QueuedTask | undefined;
          await runtime.commit(async (tx) => {
            const stored = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
            task = stored && copyOutOfCommit(stored);
          });
          await events.append({
            type: "assumed",
            project: input.project,
            target: input.key,
            title: task?.title ?? "",
            waitsVeto: task?.startedIn === "in_progress",
          });
        }
        return undefined;
      }
      if (step === "transicionar") {
        await writer.transition(input.key, "in_progress", { from: "todo" });
        return undefined;
      }
      const retroStage = (Object.entries(RETRO_STEP) as [RetroStage, string][]).find(
        ([, value]) => value === step,
      )?.[0];
      if (retroStage) {
        if ((await retro(retroStage)) && project.config.retroApproval && retroStage !== "tarefa")
          await holdAfterRetro(retroStage);
        return undefined;
      }
      if (step === "revisar") {
        await reviewLoop();
        return undefined;
      }
      if (step === "entregar") {
        for (let batch = 0; batch < 3; batch++) {
          const publishProgress = async () => {
            const publication = (await readState()).tasks.find((t) => t.id === input.id)?.publication;
            if (publication)
              await progressOnce(`PR/MR ${publication.status}${publication.url ? `: ${publication.url}` : ""}`);
          };
          let outcome: Awaited<ReturnType<typeof runDelivery>>;
          try {
            const currentTask = (await readState()).tasks.find((t) => t.id === input.id);
            const remote =
              currentTask?.publication?.number && currentTask.implementation && !project.config.dryRun
                ? await project.codeHost.inspectRequest(
                    currentTask.implementation.worktree,
                    currentTask.publication.number,
                  )
                : undefined;
            if (!remote || remote.state === "open") {
              const resumed = await resumeCorrections();
              if ((await syncBase()) || resumed) await reviewLoop();
            }
            outcome = await runDelivery({
              taskId: input.id,
              runtime,
              config: project.config,
              codeHost: project.codeHost,
              writer,
              worktreesRoot: implementationDeps.worktreesRoot,
            });
          } catch (err) {
            // Bloqueio na entrega (ex.: CI reprovada): o motivo aparece no progresso e o bloqueio segue.
            if (err instanceof StageBlocked) await progressOnce(`Entrega bloqueada: ${redactSecrets(err.message)}`);
            else await publishProgress();
            throw err;
          }
          await publishProgress();
          if (outcome !== "revisar") return outcome;
          const feedback = (await readState()).tasks.find((t) => t.id === input.id)?.publication?.pendingFeedback ?? [];
          await reviewLoop(feedback);
          await runtime.commit(async (tx) => {
            const publication = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id)?.publication;
            if (publication) {
              publication.feedbackIds = [...new Set([...publication.feedbackIds, ...feedback.map((f) => f.id)])];
              publication.pendingFeedback = [];
            }
          });
        }
        return "acompanhar";
      }

      // Uma tentativa anterior já obteve a entrega: republica a mesma, sem chamar o modelo de novo.
      let delivery: SpecDelivery | undefined;
      await runtime.commit(async (tx) => {
        const stored = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id)?.delivery;
        delivery = stored ? copyOutOfCommit(stored) : undefined;
      });

      if (step === "implementar") {
        const current = (await readState()).tasks.find((task) => task.id === input.id);
        const card = await source.getCard(input.key);
        if (!card) throw new Error(`card ${input.key} não existe mais`);
        const repository =
          current?.repositoryPath !== undefined
            ? project.config.repositories?.find((candidate) => candidate.path === current.repositoryPath)
            : resolveRepository(project.config.repositories, card);
        if (project.config.repositories?.length && !repository) {
          if (current && pendingQuestion(current)) return "aguardar";
          await ask(
            current?.questions ?? [],
            repositoryQuestion(card, project.config.repositories),
            "tecnica",
            "repositorio",
          );
          return "aguardar";
        }
        await implement(repository?.path);
        return undefined;
      }

      if (!delivery) {
        const outcome = await grill();
        if (outcome === "aguardar") return "aguardar";
        delivery = outcome;
      }
      if (project.config.specApproval) {
        let approved = false;
        await runtime.commit(async (tx) => {
          const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
          if (!task) return;
          approved = task.specReview === "approved" && task.specApprovedDryRun === project.config.dryRun;
          if (!approved) task.specReview = "draft";
        });
        if (!approved) return "aguardar";
      }
      await writer.upsertComment(input.key, "SPEC", delivery.spec);
      await writer.upsertComment(input.key, "Tickets", renderTickets(delivery.tickets));
      return undefined;

      async function implement(repositoryPath?: string): Promise<void> {
        const current = (await readState()).tasks.find((t) => t.id === input.id);
        if (!current?.delivery) throw new Error(`a etapa SPEC não deixou Tickets para ${input.key}`);
        const card = await source.getCard(input.key);
        if (!card) throw new Error(`card ${input.key} não existe mais`);
        if (current.implementation?.synchronization?.status === "iniciada") await syncBase();
        await runImplementation({
          repositoryPath,
          harness,
          runtime,
          taskId: input.id,
          config: project.config,
          codeHost: project.codeHost,
          writer,
          card,
          delivery: {
            ...current.delivery,
            tickets: [...current.delivery.tickets, ...(current.correctionTickets ?? [])],
          },
          agente: resolverAgenteDaEtapa(project.config, "implementacao"),
          deps: implementationDeps,
          tools: implementationTools,
          originalTicketCount: current.delivery.tickets.length,
          canReassessCorrections: async (head) => {
            const latest = (await readState()).tasks.find((t) => t.id === input.id);
            // A guarda vem antes da suíte; um review em andamento deve ser retomado, não descartado.
            return Boolean(latest?.review && (latest.review.head !== head || latest.review.status !== "corrigir"));
          },
          reassessCorrections: async (head, diagnostic) => {
            const verdict = await runReview({
              harness,
              runtime,
              taskId: input.id,
              config: project.config,
              worktreesRoot: implementationDeps.worktreesRoot,
              tools: reviewTools,
              agente: resolverAgenteDaEtapa(project.config, "review"),
              verification: { head, diagnostic },
            });
            const latest = (await readState()).tasks.find((t) => t.id === input.id);
            return {
              approved: verdict === "aprovado",
              feedback: `Review de reavaliação: ${latest?.review?.summary ?? "evidência insuficiente"}`,
            };
          },
        });
      }

      /** Registra progresso sem repetir: `ever` compara com todo o histórico (review recuperado), senão só com o último. */
      async function progressOnce(message: string, ever = false): Promise<void> {
        const previous = events
          .list()
          .filter((e) => e.type === "progress" && e.project === input.project && e.target === input.key)
          .map((e) => (e.type === "progress" ? e.message : ""));
        if (ever ? !previous.includes(message) : previous.at(-1) !== message)
          await events.append({ type: "progress", project: input.project, target: input.key, message });
      }

      async function syncBase(): Promise<boolean> {
        return synchronizeBase({
          taskId: input.id,
          runtime,
          harness,
          config: project.config,
          deps: implementationDeps,
        });
      }

      async function resumeCorrections(): Promise<boolean> {
        // Retoma o TDD pendente antes de exigir clone limpo para sincronização ou review.
        const interrupted = (await readState()).tasks.find((t) => t.id === input.id);
        if (interrupted?.implementation && interrupted.delivery) {
          const done = new Set([
            ...interrupted.implementation.commits.filter((c) => c.phase === "implementacao").map((c) => c.ticket),
            ...(interrupted.implementation.verifiedTickets ?? []).map((c) => c.ticket),
          ]);
          const originalCount = interrupted.delivery.tickets.length;
          if (interrupted.correctionTickets?.some((_, index) => !done.has(originalCount + index))) {
            await implement();
            return true;
          }
        }
        return false;
      }

      async function reviewLoop(feedback: { id: string; body: string; author: string }[] = []): Promise<void> {
        await resumeCorrections();
        await syncBase();
        for (;;) {
          const verdict = await runReview({
            harness,
            runtime,
            taskId: input.id,
            config: project.config,
            worktreesRoot: implementationDeps.worktreesRoot,
            tools: reviewTools,
            agente: resolverAgenteDaEtapa(project.config, "review"),
            feedback,
          });
          const reviewed = (await readState()).tasks.find((t) => t.id === input.id)?.review;
          if (verdict && reviewed)
            await progressOnce(
              `Review ${verdict} do HEAD ${reviewed.head.slice(0, 8)}: ${reviewed.summary.slice(0, 400)}`,
              true,
            );
          if (verdict !== "corrigir") return;
          await implement();
        }
      }

      /**
       * Triagem da issue (ADR-0014), só nos repositórios monitorados: checagens determinísticas e, sem decisão, o
       * modelo. `aceita` segue; `recusa` dá baixa (com prévia se `triageApproval`); `duvidosa` espera o usuário.
       */
      async function triage(): Promise<"aguardar" | "recusada" | "adiar" | undefined> {
        const { source: sourceConfig } = project.config;
        if (sourceConfig.type !== "github") return undefined;
        let record: TriageRecord | null = null;
        let conversation: ConversationId | null = null;
        await runtime.commit(async (tx) => {
          const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
          record = task?.triage ? copyOutOfCommit(task.triage) : null;
          conversation = task?.triageConversation ?? null;
        });
        if (!record) {
          const result = await evaluate(conversation);
          const fresh: TriageRecord = { result, review: null };
          await runtime.commit(async (tx) => {
            const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
            if (task && !task.triage) task.triage = fresh;
          });
          record = fresh;
        }
        const { result, review } = record as TriageRecord;
        const needsUser = result.verdict === "duvidosa" || (result.verdict === "recusa" && sourceConfig.triageApproval);
        const decision = !needsUser ? (result.verdict === "aceita" ? "aceitar" : "recusar") : review;
        if (decision === null || decision === "draft") {
          if (decision === null) {
            await runtime.commit(async (tx) => {
              const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
              if (task?.triage && task.triage.review === null) task.triage.review = "draft";
            });
            await events.append({
              type: "notify",
              project: input.project,
              target: input.key,
              reason: "triagem",
              message:
                `A triagem da issue ${input.key} ${result.verdict === "recusa" ? "propõe recusar" : "ficou em dúvida"}` +
                ` (${result.reason}). Revise e decida na página da Tarefa.`,
            });
          }
          return "aguardar";
        }
        if (decision === "aceitar") return (await hasRoom(sourceConfig.maxActive)) ? undefined : "adiar";
        await writer.commentOnce(input.key, refusalComment(result, duplicateRef(result)));
        await writer.dismiss(input.key, closeReason(result));
        return "recusada";
      }

      /**
       * Se cabe mais uma issue depois da triagem: `maxActive` conta só as Tarefas que já passaram dela. A triagem corre
       * em todas, e uma issue à espera da sua revisão não segura as outras. Cabendo, a vaga fica reservada no mesmo
       * commit (a etapa sai de `triagem`): uma pausa antes do passo seguinte não a libera para outra Tarefa.
       */
      async function hasRoom(maxActive: number): Promise<boolean> {
        let busy = 0;
        await runtime.commit(async (tx) => {
          const tasks = (await tx.doc(StateDoc)).tasks;
          busy = tasks.filter(
            (t) =>
              t.project === input.project &&
              t.id !== input.id &&
              !TERMINAL.has(t.status) &&
              t.stage != null &&
              t.stage !== "triagem",
          ).length;
          const own = tasks.find((t) => t.id === input.id);
          if (own && busy < maxActive) own.stage = "assumir";
        });
        return busy < maxActive;
      }

      /** Junta os sinais da issue e decide: pelas regras ou, sem decisão, pelo modelo. */
      async function evaluate(conversation: ConversationId | null): Promise<TriageResult> {
        const card = await source.getCard(input.key);
        if (!card) throw new Error(`card ${input.key} não existe mais`);
        const others = (await source.listAssignedCards(project.config.source.assignee)).filter(
          (c) => c.key !== card.key,
        );
        const mapping = resolveRepository(project.config.repositories, card);
        const repoPath = mapping && resolvePath(mapping.path);
        const n = Number(input.key.slice(input.key.lastIndexOf("-") + 1));
        const comments = await source.listComments(input.key);
        const decided = deterministicTriage({
          card,
          others,
          comments,
          pullRequests: (await source.linkedPullRequests?.(input.key)) ?? [],
          mergedCommit: repoPath ? await findClosingCommit(repoPath, input.key, n) : null,
        });
        if (decided) return decided;
        // Só o contexto sem frases de injeção vai ao modelo (classificador ou LLM).
        const context = trustedContext(others, repoPath ? await recentSubjects(repoPath) : []);
        const role = project.config.roles.triage ?? project.config.roles.spec;
        const classifier = opts.models
          .getModelsOfType("classifier", role.provider)
          .find((m) => m.id === role.model && m.provider === role.provider);
        if (classifier)
          return classifyTriage({
            card,
            comments,
            others: context.others,
            recentCommits: context.recentCommits,
            knowledge: await readKnowledge(project.knowledgeDir),
            classify: (ctx) => opts.models.classify(classifier, ctx),
          });
        return requestTriage({
          harness,
          commit: runtime.commit,
          taskId: runtime.taskId,
          model: role,
          card,
          others: context.others,
          context: runtime.context,
          conversationId: conversation,
          remember: async (tx, id) => {
            const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
            if (task) task.triageConversation = id;
          },
          input: triageInput({
            card,
            comments,
            others: context.others,
            recentCommits: context.recentCommits,
            knowledge: await readKnowledge(project.knowledgeDir),
          }),
        });
      }

      /** Grill → SPEC. Devolve a entrega, ou `"aguardar"` depois de levar uma pergunta ao PO. */
      async function grill(): Promise<SpecDelivery | "aguardar"> {
        let questions: Question[] = [];
        await runtime.commit(async (tx) => {
          const stored = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id)?.questions;
          questions = stored ? copyOutOfCommit(stored) : [];
        });
        // Uma pergunta já registrada e sem resposta (ex.: reinício logo depois de perguntar): só volta a esperar.
        if (questions.some((q) => q.answer === null)) return "aguardar";

        const card = await source.getCard(input.key);
        if (!card) throw new Error(`card ${input.key} não existe mais`);
        const comments = await source.listComments(input.key);
        const attachments = await source.listTextAttachments(input.key);
        if (questions.length === 0 && isShallowCard(card, comments, attachments)) {
          await ask(questions, SHALLOW_CARD_QUESTION, "card-raso");
          return "aguardar";
        }

        const answered = questions.map((q) => ({ text: q.text, answer: q.answer ?? "" }));
        const last = answered.at(-1);
        const outcome = await requestSpec({
          harness,
          commit: runtime.commit,
          taskId: runtime.taskId,
          agente: resolverAgenteDaEtapa(project.config, "spec"),
          ferramentasExtras: await ferramentasMcpDaEtapa(project.config, resolverAgenteDaEtapa(project.config, "spec")),
          instalarExtensao: (extensao) => registry.install(extensao),
          registrarConversa: (conversa) =>
            runtime.commit(async (tx) => {
              const atual = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
              if (atual) atual.specConversationId = conversa;
            }),
          context: runtime.context,
          // Uma SPEC refeita por mudança de escopo tem outro identificador: o motor não reaproveita a resposta antiga.
          requestId: `spec-${questions.length}-r${(await readState()).tasks.find((t) => t.id === input.id)?.specRevision ?? 0}`,
          exclude: await triageConversations(),
          input: specInput({
            card,
            comments,
            attachments,
            knowledge: await readKnowledge(project.knowledgeDir),
            answered,
          }),
          followUp:
            last && questions.at(-1)?.origin === "tecnica"
              ? `Resposta do usuário à pergunta técnica "${last.text}":\n\n${last.answer}\n\nSiga com a SPEC.`
              : last && questions.at(-1)?.origin === "grill"
                ? answerFollowUp(last)
                : undefined,
        });
        if (outcome.kind === "question") {
          await ask(questions, outcome.text, outcome.technical ? "tecnica" : "grill");
          return "aguardar";
        }
        if (project.config.questionApproval && !project.config.specApproval)
          throw new StageBlocked("ensaio de revisão: modelo não propôs pergunta; SPEC não publicada");
        const delivered = outcome.delivery;
        await runtime.commit(async (tx) => {
          const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
          if (task) task.delivery = delivered;
        });
        return delivered;
      }

      /** A conversa da triagem desta Tarefa, que a SPEC não pode reaproveitar. */
      /** Conversas que a SPEC não deve retomar: a da triagem e as que o usuário esqueceu. */
      async function triageConversations(): Promise<string[]> {
        const task = (await readState()).tasks.find((t) => t.id === input.id);
        const excluidas = [
          ...(task?.triageConversation ? [task.triageConversation] : []),
          ...(task?.conversasEsquecidas ?? []),
        ];
        return excluidas.map((c) => String(c));
      }

      /** A retrô de uma etapa de modelo, ou a consolidada. A implementação que não rodou não tem retrô. */
      async function retro(stage: RetroStage): Promise<boolean> {
        const task = (await readState()).tasks.find((t) => t.id === input.id);
        if (
          !task ||
          (stage === "implementacao" && !task.implementation) ||
          (stage === "triagem" && !task.triage) ||
          (stage === "review" && !task.review) ||
          (stage === "mr" && !task.publication)
        )
          return false;
        await runRetro({
          harness,
          runtime,
          taskId: input.id,
          cardKey: input.key,
          stage,
          config: project.config,
          writer,
          events: eventRecorder,
          agente: resolverAgenteDaEtapa(project.config, "retro"),
          input: async () => {
            const current = (await readState()).tasks.find((t) => t.id === input.id) ?? task;
            return retroInput(stage, current, events.list());
          },
          sink: opts.retro?.sink,
          repo: opts.retro?.repo,
        });
        return true;
      }

      /** Portão `retroApproval`: pede pausa (o próximo passo espera) e avisa o usuário, uma vez por etapa. */
      async function holdAfterRetro(stage: RetroStage): Promise<void> {
        let held = false;
        await runtime.commit(async (tx) => {
          const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
          if (!task || task.retroHeld?.includes(stage)) return;
          task.retroHeld = [...(task.retroHeld ?? []), stage];
          task.pauseRequested = true;
          held = true;
        });
        if (!held) return;
        await events.append({
          type: "notify",
          project: input.project,
          target: input.key,
          reason: "retro-pronta",
          message:
            `A retrô da etapa ${stage} do card ${input.key} está pronta. ` +
            "A Tarefa está pausada antes da próxima etapa: revise e retome para continuar.",
        });
      }

      /** Leva a pergunta ao PO pelo Canal e a registra com os prazos de escalonamento em horas úteis. */
      async function ask(
        previous: Question[],
        text: string,
        origin: Question["origin"],
        purpose?: Question["purpose"],
      ): Promise<void> {
        const tecnica = origin === "tecnica";
        if (tecnica) {
          try {
            validarDestinatarioDoProjeto(
              project.config.people.map((p) => p.id),
              project.config.source.assignee,
            );
          } catch (erro) {
            throw new StageBlocked((erro as Error).message);
          }
        }
        const po = tecnica
          ? project.config.people.find((p) => p.id === project.config.source.assignee)
          : pessoasDoPapel(project.config, "po")[0];
        if (!po)
          throw new StageBlocked(`o grill precisa perguntar ao PO, mas o projeto ${input.project} não declara um`);
        if (!tecnica && avisoTeamsDe(po) && (!project.config.source.baseUrl || !opts.teams))
          throw new StageBlocked("aviso ao PO no Teams configurado sem origem Jira ou conexão MCP");
        if (previous.length >= MAX_PO_QUESTIONS)
          throw new StageBlocked(
            `o grill já fez ${MAX_PO_QUESTIONS} perguntas ao PO e ainda quer perguntar: "${text}"`,
          );
        const n = previous.length + 1;
        const ref =
          tecnica || project.config.questionApproval
            ? { card: input.key, to: po.id, before: [] }
            : await project.channel.ask({ card: input.key, to: po.id, text: `Pergunta ${n}: ${text}` });
        const askedAt = clock.now();
        const { calendar } = project.config;
        const question: Question = {
          n,
          origin,
          ...(purpose ? { purpose } : {}),
          to: po.id,
          text,
          ref,
          askedAt,
          remindAt: tecnica
            ? prazoPerguntaTecnica(askedAt)
            : addBusinessHours(calendar, askedAt, REMINDER_BUSINESS_HOURS),
          notifyAt: addBusinessHours(calendar, askedAt, workdayHours(calendar)),
          reminded: false,
          notified: false,
          answer: null,
          ...(!tecnica && project.config.questionApproval ? { publication: "draft" as const } : {}),
          ...(!tecnica && avisoTeamsDe(po) && project.config.source.baseUrl && !project.config.dryRun
            ? {
                teamsNotice: {
                  userId: avisoTeamsDe(po) as string,
                  link: `${project.config.source.baseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(input.key)}`,
                  status: "pending" as const,
                },
              }
            : {}),
        };
        await runtime.commit(async (tx) => {
          const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
          if (task && !task.questions?.some((q) => q.n === n)) task.questions = [...(task.questions ?? []), question];
        });
        if (!tecnica && project.config.questionApproval) return;
        await sendTeamsNotice(input.id, input.project, input.key, n);
        await events.append({
          type: "question",
          project: input.project,
          target: input.key,
          n,
          to: po.id,
          text,
          status: "enviada",
        });
      }
    },
    async escalate(input, runtime) {
      const project = projectOf(input.project);
      if (project.config.activity === "business-hours") {
        const next = nextProjectActivity(project.config, runtime.now());
        if (next > runtime.now()) return next;
      }
      let question: Question | undefined;
      await runtime.commit(async (tx) => {
        const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
        const pending = task && pendingQuestion(task);
        question = pending ? copyOutOfCommit(pending) : undefined;
      });
      if (!question) return null;
      const q = question;
      // As perguntas técnicas são respondidas localmente, não pelo comentário no card.
      // O encaminhamento ao tech lead é tratado pelo fluxo técnico, não pelo lembrete ao PO.
      if (q.origin === "tecnica") {
        await forwardTechnical(input.id, q.n);
        return !q.forwarding && runtime.now() < q.remindAt ? q.remindAt : null;
      }
      if (q.publication === "draft" || q.publication === "sending") return runtime.now() + 60_000;
      if (await checkAnswer(input, q)) return null;

      const now = runtime.now();
      if (!q.reminded && now >= q.remindAt && project.config.questionApproval) {
        // Com revisão, o lembrete não sai sozinho: vira rascunho e o usuário o aprova pela página.
        await markQuestion(input.id, q.n, (stored) => {
          stored.reminded = true;
          stored.reminder ??= "draft";
        });
        await events.append({
          type: "notify",
          project: input.project,
          target: input.key,
          reason: "pergunta-sem-resposta",
          message: `O lembrete da pergunta ${q.n} no card ${input.key} aguarda a sua revisão antes de ser publicado.`,
        });
        q.reminded = true;
      }
      if (!q.reminded && now >= q.remindAt) {
        await project.channel.remind(q.ref, reminderText(q));
        await markQuestion(input.id, q.n, (stored) => {
          stored.reminded = true;
        });
        await events.append({
          type: "question",
          project: input.project,
          target: input.key,
          n: q.n,
          to: q.to,
          text: q.text,
          status: "lembrete",
        });
        q.reminded = true;
      }
      // Fatia 07: pergunta de negócio sem resposta no prazo escalona à pessoa seguinte do perfil PO. Com revisão de
      // perguntas, o escalonamento vira rascunho: só sai no card depois da aprovação, como a pergunta original.
      const seguinte = !q.notified && now >= q.notifyAt ? proximaPessoaDoPapel(project.config, "po", q.to) : undefined;
      if (seguinte) {
        const revisao = project.config.questionApproval;
        const ref = revisao
          ? { card: input.key, to: seguinte.id, before: [] }
          : await project.channel.ask({
              card: input.key,
              to: seguinte.id,
              // O texto nomeia a pessoa: sem isso, a deduplicação do escritor trataria a repetição como a mesma mensagem.
              text: `Pergunta ${q.n} (encaminhada a ${seguinte.name ?? seguinte.id}): ${q.text}`,
            });
        const { calendar } = project.config;
        await markQuestion(input.id, q.n, (stored) => {
          stored.to = seguinte.id;
          stored.ref = ref;
          stored.reminded = false;
          stored.notified = false;
          if (revisao) stored.publication = "draft";
          stored.remindAt = addBusinessHours(calendar, now, REMINDER_BUSINESS_HOURS);
          stored.notifyAt = addBusinessHours(calendar, now, workdayHours(calendar));
        });
        await events.append(
          revisao
            ? {
                type: "notify",
                project: input.project,
                target: input.key,
                reason: "pergunta-sem-resposta",
                message: `A pergunta ${q.n} no card ${input.key} foi encaminhada a ${seguinte.name ?? seguinte.id} e aguarda a sua revisão.`,
              }
            : {
                type: "question",
                project: input.project,
                target: input.key,
                n: q.n,
                to: seguinte.id,
                text: q.text,
                status: "escalonada",
              },
        );
        return addBusinessHours(calendar, now, REMINDER_BUSINESS_HOURS);
      }
      if (!q.notified && now >= q.notifyAt) {
        await events.append({
          type: "notify",
          project: input.project,
          target: input.key,
          reason: "pergunta-sem-resposta",
          message: `A pergunta ${q.n} ao PO no card ${input.key} está há 1 dia útil sem resposta: ${q.text}`,
        });
        await markQuestion(input.id, q.n, (stored) => {
          stored.notified = true;
        });
        q.notified = true;
      }
      const next = [!q.reminded ? q.remindAt : null, !q.notified ? q.notifyAt : null].filter((t) => t !== null);
      return next.length > 0 ? Math.min(...next) : null;
    },
    inspect: (input) => inspectCard(input),
    vetoMs: (input) => projectOf(input.project).config.vetoMinutes * 60_000,
    async announceVeto(input, until) {
      const { vetoMinutes } = projectOf(input.project).config;
      await events.append({
        type: "notify",
        project: input.project,
        target: input.key,
        reason: "aguardando-veto",
        until: new Date(until).toISOString(),
        message:
          `A fábrica assumiu o card ${input.key}, que já estava em andamento, e continua o trabalho nele em ` +
          `${vetoMinutes} min (${new Date(until).toISOString()}) se você não vetar.`,
      });
    },
    classify: (err) =>
      err instanceof GuardrailViolation || err instanceof StageBlocked || err instanceof InspectionBlocked
        ? { kind: "blocked", reason: err.message }
        : { kind: "error", message: err instanceof Error ? err.message : String(err) },
    onError: (input, message) => events.append({ type: "error", project: input.project, target: input.key, message }),
  });

  /** Referência do GitHub (`#n`) à issue de que esta é duplicata. */
  function duplicateRef(result: TriageResult): string | undefined {
    const key = result.duplicateOf;
    return key && /-\d+$/.test(key) ? `#${key.slice(key.lastIndexOf("-") + 1)}` : undefined;
  }

  /** Como fechar a issue recusada. */
  function closeReason(result: TriageResult): "completed" | "not_planned" | "duplicate" {
    if (result.closeAs) return result.closeAs;
    if (result.category === "duplicata") return "duplicate";
    if (result.category === "ja-feito" || result.category === "resolvida") return "completed";
    return "not_planned";
  }

  /** Inspeção do repositório de um card que já estava em andamento (ADR-0013). */
  async function inspectCard(input: {
    project: string;
    key: string;
  }): Promise<{ kind: "seguir" } | { kind: "bloquear"; reason: string } | { kind: "veto" }> {
    const project = projectOf(input.project);
    const card = await project.source.getCard(input.key);
    const mapping = card && resolveRepository(project.config.repositories, card);
    if (!mapping) return { kind: "veto" };
    const merged = await findMergedWork(resolvePath(mapping.path), input.key);
    if (!merged) return { kind: "seguir" };
    return {
      kind: "bloquear",
      reason: `card já implementado: o commit ${merged.sha} ("${merged.subject}") da branch padrão cita ${input.key}`,
    };
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
  const criadosPelaInterface = new Set<string>();
  /** Pendências que barram ações: as de um projeto criado pela UI, e a confirmação de uma troca de Fonte (ticket 10). */
  const pendenciasBloqueantes = (nome: string, state: FactoryState): string[] =>
    comConfirmacaoPendente(
      criadosPelaInterface.has(nome) ? pendenciasDeConfiguracao(projectOf(nome).config) : [],
      state,
      nome,
    );

  /** Registra um projeto criado pela UI no processo, com a Fonte e o conhecimento do mesmo jeito que os do YAML. */
  function registrarProjeto(config: ProjectConfig): void {
    if (!opts.createSource) throw new Error("este daemon não cria a Fonte de projetos da interface");
    criadosPelaInterface.add(config.name);
    const knowledgeDir = opts.knowledgeDirFor?.(config.name);
    const base: FactoryProject = {
      config,
      source: opts.createSource(config),
      ...(knowledgeDir ? { knowledgeDir } : {}),
    };
    bases.set(config.name, base);
    projects.set(config.name, montarProjeto(base));
  }

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
  for (const p of opts.projects) {
    const guardada = lerConfiguracao((await readState()).projetos?.[p.config.name]);
    if (guardada) aplicarConfiguracao(guardada);
  }
  for (const nome of Object.keys((await readState()).projetosRemovidos ?? {})) {
    projects.delete(nome);
    bases.delete(nome);
    criadosPelaInterface.delete(nome);
  }

  // Projetos criados pela UI voltam com o estado. Um nome que o YAML já usa não é sobrescrito (o YAML manda).
  for (const [nome, salvo] of Object.entries((await readState()).projetosGitHub ?? {})) {
    if (projects.has(nome)) continue;
    const lido = ProjectConfig.safeParse(JSON.parse(salvo));
    if (!lido.success) {
      console.error(`[fábrica] projeto ${nome} salvo pela interface está inválido e não foi carregado`);
      continue;
    }
    if (!opts.createSource) {
      console.error(`[fábrica] projeto ${nome} salvo pela interface não carregado: este daemon não cria Fontes`);
      continue;
    }
    // A configuração guardada é a que vale: a edição pela interface grava em `projetos`, depois da criação.
    registrarProjeto(lerConfiguracao((await readState()).projetos?.[nome]) ?? lido.data);
  }
  retroSettings.repo = (await readState()).retroRepo ?? retroSettings.repo;
  if (!retroSettings.repo)
    console.warn(
      "[fábrica] Configure o repositório das retrôs em Configurar publicações na web; nenhuma issue será publicada sem aprovação.",
    );
  await reinspectPendingVetoes();

  /**
   * Tarefas que já dormiam no prazo de veto quando o daemon subiu (ex.: assumidas antes da ADR-0013): reinspeciona o
   * repositório e, sem trabalho anterior, encerra o prazo agora; a Tarefa acorda, volta à fila e segue para a SPEC.
   */
  async function reinspectPendingVetoes(): Promise<void> {
    const waiting = (await readState()).tasks.filter(
      (t) => t.status === "aguardando-veto" && t.veto && !t.veto.expired && clock.now() < t.veto.until,
    );
    for (const t of waiting) {
      let inspection: Awaited<ReturnType<typeof inspectCard>>;
      try {
        inspection = await inspectCard(t);
      } catch (err) {
        console.error(`[fábrica] reinspeção de ${t.id} falhou; o prazo de veto continua:`, err);
        continue;
      }
      if (inspection.kind !== "seguir") continue;
      let gate: number | null = null;
      await harness.commit(async (tx) => {
        const task = (await tx.doc(StateDoc)).tasks.find((x) => x.id === t.id);
        if (task?.status !== "aguardando-veto" || !task.veto) return;
        task.veto.until = clock.now();
        gate = task.gateId;
      }, context);
      if (gate !== null) await harness.abortTask(gate as TaskId, context);
    }
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
      const question = (await tx.doc(StateDoc)).tasks.find((t) => t.id === id)?.questions?.find((q) => q.n === n);
      if (question) change(question);
    }, context);
  }

  /** Reserva antes de enviar: uma falha ambígua ou reinício nunca repetem automaticamente uma mensagem. */
  async function sendTeamsNotice(id: string, project: string, key: string, n: number): Promise<void> {
    const config = projectOf(project).config;
    if (!opts.teams || config.dryRun || (config.source.keys && !config.source.keys.includes(key))) return;
    const notice = await harness.commit(async (tx) => {
      const state = await tx.doc(StateDoc);
      const task = state.tasks.find((t) => t.id === id);
      if (
        state.daemonPaused ||
        !task ||
        task.pauseRequested ||
        projetoPausado(state, task.project) ||
        !["ativa", "aguardando-humano"].includes(task.status)
      )
        return undefined;
      const q = task.questions?.find((item) => item.n === n);
      if (q?.teamsNotice?.status !== "pending" || q.answer !== null) return undefined;
      if (!pessoasDoPapel(config, "po").some((p) => p.id === q.to && identidadeTeams(p) === q.teamsNotice?.userId))
        return undefined;
      q.teamsNotice.status = "attempted";
      const po = pessoasDoPapel(config, "po").find((p) => p.id === q.to);
      return { userId: q.teamsNotice.userId, link: q.teamsNotice.link, title: task.title, name: po?.name };
    }, context);
    if (!notice) return;
    try {
      await canaisDeAviso.create("teams", { notifier: opts.teams }).send({
        userId: notice.userId,
        text: teamsQuestionMessage({ card: key, title: notice.title, link: notice.link, name: notice.name }),
      });
      await markQuestion(id, n, (q) => {
        if (q.teamsNotice) q.teamsNotice.status = "sent";
      });
    } catch {
      await markQuestion(id, n, (q) => {
        if (q.teamsNotice) q.teamsNotice.status = "uncertain";
      });
      await events.append({
        type: "error",
        project,
        target: key,
        message: "aviso Teams não confirmado; verifique o chat antes de tentar novamente",
      });
    }
  }

  /** Lê a resposta pelo Canal; se chegou, registra e devolve a Tarefa à fila. */
  async function checkAnswer(task: { id: string; project: string; key: string }, q: Question): Promise<boolean> {
    if (q.origin === "tecnica") return false;
    const answer = await projectOf(task.project).channel.answer(q.ref);
    if (answer === undefined) return false;
    const recorded = await harness.commit(
      async (tx) => recordAnswer(await tx.doc(StateDoc), task.id, q.n, answer),
      context,
    );
    if (recorded)
      await events.append({
        type: "question",
        project: task.project,
        target: task.key,
        n: q.n,
        to: q.to,
        text: q.text,
        status: "respondida",
      });
    return true;
  }

  /** Confere, na Fonte, a resposta de cada Tarefa que aguarda uma pessoa. */
  async function checkAnswers(): Promise<void> {
    for (const task of (await readState()).tasks) {
      const pending = task.status === "aguardando-humano" ? pendingQuestion(task) : undefined;
      if (!pending || pending.publication === "draft" || pending.publication === "sending") continue;
      try {
        const config = projectOf(task.project).config;
        if (nextProjectActivity(config, clock.now()) > clock.now()) continue;
        await sendTeamsNotice(task.id, task.project, task.key, pending.n);
        await checkAnswer(task, pending);
      } catch (err) {
        await events.append({
          type: "error",
          project: task.project,
          target: task.key,
          message: `falha ao conferir a resposta: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // --- Fila ------------------------------------------------------------------------------------

  /** Cards elegíveis na Fonte agora. Num repositório monitorado, as issues mais antigas primeiro. */
  async function queue(): Promise<QueueItem[]> {
    const items: QueueItem[] = [];
    const state = await readState();
    for (const { config, source } of projects.values()) {
      // Repositório desativado não entra na busca: nenhuma Tarefa nova dele (ADR-0015).
      if (repoDesativado(state, config.name)) continue;
      // Projeto pausado pelo usuário não busca cards novos (ticket 09).
      if (projetoPausado(state, config.name)) continue;
      // Projeto criado pela UI e incompleto não executa: a interface mostra o que falta (ADR-0022).
      if (pendenciasBloqueantes(config.name, state).length > 0) continue;
      const cards = await source.listAssignedCards(config.source.assignee);
      if (config.source.type === "github") cards.sort((a, b) => issueOrder(a.key) - issueOrder(b.key));
      for (const card of cards) {
        const state = config.statuses[card.status];
        if (card.assignee !== config.source.assignee || !state || !ELIGIBLE.has(state)) continue;
        if (config.source.keys && !config.source.keys.includes(card.key)) continue;
        items.push({ project: config.name, key: card.key, title: card.title, status: card.status, state });
      }
    }
    return items;
  }

  /** Número da issue na chave `<projeto>-<n>`, para ordenar das mais antigas para as mais novas. */
  const issueOrder = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1)) || 0;

  /**
   * Busca na Fonte: enfileira os cards elegíveis que ainda não viraram Tarefa e confere as respostas esperadas. Num
   * repositório monitorado, no máximo `maxActive` Tarefas não terminadas por vez.
   */
  async function poll(): Promise<void> {
    try {
      await reconcileRepos();
    } catch (err) {
      // Uma falha do GitHub nesta consulta não pode impedir a busca dos cards.
      console.error("[fábrica] sincronização com o GitHub falhou:", redactSecrets(String(err)));
    }
    await checkAnswers();
    const eligible = await queue();
    await harness.commit(async (tx) => {
      const state = await tx.doc(StateDoc);
      for (const item of eligible) {
        const id = `${item.project}/${item.key}`;
        if (state.tasks.some((t) => t.id === id)) continue;
        state.tasks.push({
          id,
          project: item.project,
          key: item.key,
          title: item.title,
          ref: newTaskRef(),
          status: "enfileirada",
          durableId: null,
          gateId: null,
          pauseRequested: false,
          notBefore: null,
          attempts: 0,
          reason: null,
          startedIn: item.state,
          veto: null,
          delivery: null,
          implementation: null,
        });
      }
    }, context);
  }

  // --- Agendador -------------------------------------------------------------------------------

  let closing = false;
  let disarmRetry: (() => void) | undefined;
  let known = new Map((await readState()).tasks.map((t) => [t.id, t.status]));

  /** Tarefas enfileiradas cujo projeto sumiu da config: já avisadas neste processo (evita loop via react). */
  const missingProjectReported = new Set<string>();

  /** Ativa a próxima Tarefa se nenhuma estiver ativa. Abre o portão de uma Tarefa que estava pausada. */
  async function schedule(): Promise<void> {
    const state = await readState();
    if (state.daemonPaused || state.tasks.some((t) => t.status === "ativa")) return;
    const now = clock.now();
    let next: QueuedTask | undefined;
    let wakeAt = Number.POSITIVE_INFINITY;
    for (const task of state.tasks) {
      if (!["enfileirada", "aguardando-entrega"].includes(task.status) || task.pauseRequested) continue;
      // Repositório desativado: a Tarefa espera o replugue ou o desplugue (ADR-0015).
      if (repoDesativado(state, task.project)) continue;
      // Projeto pausado: a Tarefa espera a retomada, sem começar (ticket 09).
      if (projetoPausado(state, task.project)) continue;
      // Projeto criado pela UI e incompleto não executa nenhuma ação (ADR-0022): a Tarefa espera o projeto ficar pronto.
      if (pendenciasBloqueantes(task.project, state).length > 0) continue;
      const project = projects.get(task.project);
      if (!project) {
        if (!missingProjectReported.has(task.id)) {
          missingProjectReported.add(task.id);
          await events.append({
            type: "error",
            project: task.project,
            target: task.key,
            message: `falha ao agendar: Projeto ${task.project} não está configurado`,
          });
        }
        continue;
      }
      const at = Math.max(task.notBefore ?? 0, nextProjectActivity(project.config, now));
      if (at <= now) {
        if (!next) next = task;
      } else if (at < wakeAt) {
        wakeAt = at;
      }
    }
    if (!next) {
      if (Number.isFinite(wakeAt) && !closing) {
        disarmRetry?.();
        disarmRetry = armTimer(react, Math.max(0, wakeAt - now));
      }
      return;
    }
    let gateToOpen: number | null = null;
    await harness.commit(async (tx) => {
      const draft = await tx.doc(StateDoc);
      const task = draft.tasks.find((t) => t.id === next.id);
      if (
        !task ||
        !["enfileirada", "aguardando-entrega"].includes(task.status) ||
        draft.tasks.some((t) => t.status === "ativa")
      )
        return;
      task.status = "ativa";
      task.notBefore = null;
      if (task.gateId !== null) {
        gateToOpen = task.gateId;
        task.gateId = null;
      } else {
        task.durableId = await tx.createTask(
          Tarefa,
          { id: task.id, project: task.project, key: task.key },
          { ownership: { kind: "conversation" }, conversationId: ROOT_CONVERSATION_ID },
        );
      }
    }, context);
    if (gateToOpen !== null) await harness.abortTask(gateToOpen as TaskId, context);
  }

  /** Emite um evento para cada Tarefa que mudou de status desde a última vez. */
  const lastEmitted = new Map<string, string>();
  async function emitStatusChanges(): Promise<void> {
    const state = await readState();
    const changed = state.tasks.filter((t) => known.get(t.id) !== t.status);
    known = new Map(state.tasks.map((t) => [t.id, t.status]));
    for (const t of changed) {
      // Acompanhamento do PR/MR: cada consulta passa por "ativa"; só registra quando o estado observado muda.
      const signature = `${t.status}|${t.reason ?? ""}`;
      const last = lastEmitted.get(t.id);
      if (t.status === "ativa" && last?.startsWith("aguardando-entrega|")) continue;
      if (last === signature) continue;
      lastEmitted.set(t.id, signature);
      await events.append({
        type: "task",
        project: t.project,
        id: t.id,
        key: t.key,
        status: t.status,
        ...(t.reason &&
        (t.status === "bloqueada" ||
          t.status === "enfileirada" ||
          t.status === "vetada" ||
          t.status === "aguardando-entrega")
          ? { reason: t.reason }
          : {}),
      });
    }
  }

  // Reage a cada commit: uma reação por vez, e no máximo uma pendente.
  let reacting: Promise<void> = Promise.resolve();
  let reactPending = false;
  function react(): void {
    if (reactPending || closing) return;
    reactPending = true;
    reacting = reacting.then(async () => {
      reactPending = false;
      if (closing) return;
      try {
        await emitStatusChanges();
        await schedule();
      } catch (err) {
        if (!closing) console.error("[fábrica] erro no agendador:", err);
      }
    });
  }
  const observation = harness.observeCommits({ advance: () => queueMicrotask(react), end: () => undefined });
  harness.resume();
  react();

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
  const webhookProjects = (): WebhookProject[] =>
    [...projects.values()].map((p) => ({ name: p.config.name, config: p.config }));

  /**
   * Executa os efeitos que o estado não executa sozinho: parar uma execução durável e registrar um aviso ao usuário.
   */
  async function runWebhookEffects(effects: WebhookEffect[]): Promise<void> {
    for (const effect of effects) {
      if (effect.type === "abortar") {
        const durableId = (await readState()).tasks.find((t) => t.id === effect.id)?.durableId;
        if (durableId !== null && durableId !== undefined) await harness.abortTask(durableId as TaskId, context);
        continue;
      }
      await avisos.add({
        type: "notificar",
        project: effect.project,
        target: effect.target,
        reason: effect.reason,
        message: effect.message,
      });
    }
  }

  /** Janela de sobreposição da consulta de alterações: cobre edições feitas enquanto a própria consulta rodava. */
  const SYNC_OVERLAP_MS = 60_000;

  /**
   * Reconciliação (ADR-0015): para cada repositório ativo, consulta o que mudou desde a última sincronização e aplica o
   * que o webhook não entregou. Sem sincronização anterior, só grava a linha de base: a busca cuida dos cards abertos.
   */
  async function reconcileRepos(): Promise<void> {
    const startedAt = new Date(clock.now()).toISOString();
    for (const { config, source } of projects.values()) {
      if (config.source.type !== "github" || !source.listChangedSince) continue;
      const state = await readState();
      if (repoDesativado(state, config.name)) continue;
      const since = state.sincronizadoEm?.[config.name];
      if (since !== undefined) {
        const snapshots = await source.listChangedSince(new Date(Date.parse(since) - SYNC_OVERLAP_MS).toISOString());
        const deliveries = reconciliarIssues({ state, project: { name: config.name, config }, snapshots });
        for (const delivery of deliveries) await applyGitHubDelivery(delivery);
      }
      await harness.commit(async (tx) => {
        const current = await tx.doc(StateDoc);
        current.sincronizadoEm = { ...current.sincronizadoEm, [config.name]: startedAt };
      }, context);
    }
  }

  /**
   * Aplica uma entrega do GitHub (issue ou instalação do App) ao estado e executa os efeitos. Um reenvio de entrega já
   * aplicada não muda nada (ver `FactoryState.deliveries`).
   */
  async function applyGitHubDelivery(delivery: IssueDelivery | InstallationDelivery): Promise<void> {
    let effects: WebhookEffect[] = [];
    let duplicate = false;
    await harness.commit(async (tx) => {
      const state = await tx.doc(StateDoc);
      if (state.deliveries?.includes(delivery.deliveryId)) {
        duplicate = true;
        return;
      }
      effects =
        "repo" in delivery
          ? applyToState({ state, delivery, projects: webhookProjects(), newRef: newTaskRef })
          : applyInstallationToState({ state, delivery, projects: webhookProjects() });
      state.deliveries = [...(state.deliveries ?? []), delivery.deliveryId].slice(-DELIVERY_MEMORY);
      state.ultimoWebhookEm = new Date(clock.now()).toISOString();
    }, context);
    if (!duplicate) await runWebhookEffects(effects);
  }

  /** Acha o projeto monitorado de um repositório (`dono/nome`, sem diferenciar caixa). */
  const projectByRepo = (repo: string): string | undefined => {
    for (const { config } of projects.values()) {
      if (config.source.type === "github" && config.source.repo.toLowerCase() === repo.toLowerCase())
        return config.name;
    }
    return undefined;
  };

  /** Vínculos dos projetos monitorados: o que está ativo, o que foi desativado e de qual instalação veio. */
  async function listRepos(): Promise<RepoListItem[]> {
    const state = await readState();
    const repos: RepoListItem[] = [];
    for (const { config } of projects.values()) {
      if (config.source.type !== "github") continue;
      const binding = state.repos?.[config.name];
      repos.push({
        project: config.name,
        repo: config.source.repo,
        status: binding?.status ?? "ativo",
        installationId: binding?.installationId ?? null,
        motivo: binding?.motivo ?? null,
      });
    }
    return repos;
  }

  /**
   * Painel do GitHub App. A cobertura só é dita quando a consulta ao App deu certo: sem ela, `coberto` é `null`, e a
   * página não afirma nada que não sabe.
   */
  /**
   * Catálogo de repositórios do App (Fase 2): só leitura, sem token nem chave. `plugado` diz se algum projeto de
   * repositório monitorado já aponta para o repositório (comparação sem caixa), com o status do vínculo.
   */
  async function githubReposCatalog(): Promise<GitHubReposCatalog> {
    const app = await appChecker.status();
    const plugados = new Map((await listRepos()).map((r) => [r.repo.toLowerCase(), r]));
    const importacoes = (await readState()).importacoes ?? {};
    const repos = app.configurado && !app.erro ? catalogoDoApp(app) : [];
    return {
      configurado: app.configurado,
      ...(app.erro ? { erro: app.erro } : {}),
      consultadoEm: app.consultadoEm,
      repos: repos.map((r) => {
        const plugado = plugados.get(r.nome.toLowerCase());
        return {
          ...r,
          plugado: plugado ? { projeto: plugado.project, status: plugado.status } : null,
          importacao: importacoes[String(r.id)] ?? null,
        };
      }),
    };
  }

  /**
   * Fila de importações (Fase 3): uma por vez, em ordem, separada da fila de buscas. Cada item relê o estado antes de
   * rodar, para não repetir um repositório que já terminou.
   */
  let importando: Promise<void> = Promise.resolve();
  function enfileirarImportacao(repoId: number): void {
    importando = importando
      .then(() => executarImportacao(repoId))
      .catch((err) => console.error("[fábrica] importação falhou:", redactSecrets(String(err))));
  }

  /** Lê as issues abertas do repositório e aplica tudo numa só escrita: se a leitura falhar, nada muda. */
  async function executarImportacao(repoId: number): Promise<void> {
    const registro = (await readState()).importacoes?.[String(repoId)];
    if (registro?.status !== "importando") return;
    const repo = registro.repo;
    try {
      const app = await appChecker.status();
      if (!app.configurado || app.erro) throw new Error(app.erro ?? "GitHub App não configurado");
      const atual = catalogoDoApp(app).find((r) => r.id === repoId);
      if (!atual) throw new Error(`${repo} não está mais no catálogo do App`);
      const project = projectByRepo(atual.nome);
      if (!project) throw new Error(`nenhum projeto monitora ${atual.nome}`);
      const issues = await appChecker.issuesAbertas(atual.nome, atual.instalacaoId);
      let effects: WebhookEffect[] = [];
      await harness.commit(async (tx) => {
        const state = await tx.doc(StateDoc);
        const projeto = webhookProjects().find((p) => p.name === project);
        if (!projeto) throw new Error(`projeto ${project} não está carregado`);
        const aplicado = aplicarImportacao({
          state,
          project: projeto,
          repoId,
          repo: atual.nome,
          installationId: atual.instalacaoId,
          issues,
          newRef: newTaskRef,
        });
        effects = aplicado.effects;
        state.importacoes = {
          ...state.importacoes,
          [String(repoId)]: {
            repoId,
            repo: atual.nome,
            status: "ok",
            ultimaImportacaoEm: new Date(clock.now()).toISOString(),
            installationId: atual.instalacaoId,
            ultimoResultado: aplicado.resultado,
          },
        };
      }, context);
      await runWebhookEffects(effects);
    } catch (err) {
      await harness.commit(async (tx) => {
        const state = await tx.doc(StateDoc);
        const anterior = state.importacoes?.[String(repoId)];
        state.importacoes = {
          ...state.importacoes,
          [String(repoId)]: {
            repoId,
            repo,
            ...(anterior?.installationId !== undefined ? { installationId: anterior.installationId } : {}),
            status: "erro",
            ...(anterior?.ultimaImportacaoEm ? { ultimaImportacaoEm: anterior.ultimaImportacaoEm } : {}),
            ...(anterior?.ultimoResultado ? { ultimoResultado: anterior.ultimoResultado } : {}),
            ultimoErro: redactSecrets(err instanceof Error ? err.message : "falha desconhecida"),
          },
        };
      }, context);
    }
  }

  /** Confere a Fonte antes de gravar: credencial no cofre e, no Jira, a conexão (ADR-0018). Devolve o erro, se houver. */
  async function erroDaFonte(fonte: ProjectConfig["source"]): Promise<string | undefined> {
    if (fonte.type === "jira") {
      if (!fonte.credential) return undefined;
      if (!(await segredos.has(fonte.credential))) return `credencial ${fonte.credential} não cadastrada`;
      if (!fonte.baseUrl || !fonte.email) return "a Fonte Jira com credencial precisa de baseUrl e email";
      const conexao = await testarConexaoJira({
        baseUrl: fonte.baseUrl,
        email: fonte.email,
        token: (await segredos.get(fonte.credential)) ?? "",
        fetch: opts.fetchFonte ?? fetch,
      });
      return conexao.ok ? undefined : `conexão com o Jira falhou (${conexao.motivo})`;
    }
    if (fonte.credential && !(await segredos.has(fonte.credential)))
      return `credencial ${fonte.credential} não cadastrada`;
    return undefined;
  }

  /** Diretório onde a fábrica clona o repositório de um projeto criado pela interface (nunca um caminho do usuário). */
  const caminhoDoClone = (nome: string) => join(dirname(resolvePath(opts.statePath)), "repositorios", nome);

  /**
   * Grava um projeto novo cujo repositório a fábrica clona antes. Nome, prefixo e a Fonte de issues não podem repetir o
   * que já existe, nas duas pontas (antes e depois do clone). O clone sai antes da gravação: se a clonagem falhar,
   * nada fica salvo pela metade.
   */
  /** Projetos já existentes: os ativos na memória e os salvos pela interface (incluindo os ainda não carregados). */
  const salvosDe = (state: FactoryState) =>
    Object.values(state.projetosGitHub ?? {}).flatMap((t) => {
      // Um registro salvo inválido não impede criar outro projeto; no startup ele já é avisado e ignorado.
      const lido = ProjectConfig.safeParse(JSON.parse(t));
      return lido.success ? [lido.data] : [];
    });

  /**
   * Conflito do projeto novo com o que já existe: nome, prefixo ou a mesma Fonte de issues no mesmo repositório. É
   * conferido antes de qualquer chamada ao provedor, para que a recusa seja imediata e não dependa da rede.
   */
  async function conflitoAgora(config: ProjectConfig): Promise<string | undefined> {
    const existentes = [...projects.values()].map((p) => p.config);
    return conflitoProjeto(
      {
        nome: config.name,
        prefixo: config.source.project,
        fonteTipo: config.source.type,
        fonteRepo: "repo" in config.source ? config.source.repo : undefined,
      },
      [...existentes, ...salvosDe(await readState())],
      projetosReservados(await readState()),
    );
  }

  /** Escolhas de PO e tech lead do corpo da criação: texto vazio ou ausente vira "não escolhida". */
  function lerEscolhasPessoas(bruto: unknown): EscolhasPessoas | undefined {
    if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return undefined;
    const { po, techLead } = bruto as { po?: unknown; techLead?: unknown };
    const texto = (valor: unknown) => (typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined);
    return { po: texto(po), techLead: texto(techLead) };
  }

  /**
   * Lista de pessoas para escolher PO e tech lead no formulário de criação (ticket 06). Só consulta; nada é gravado. O
   * corpo diz de qual Fonte se trata: `gitlab` (caminho e servidor, com o token do cofre), `github` (repositório do
   * catálogo do App) ou `jira` (baseUrl, email, projeto e credencial).
   */
  async function listarPessoasParaCriacao(bruto: unknown): Promise<{ status: number; body: unknown }> {
    const corpo = (bruto ?? {}) as Record<string, unknown>;
    const texto = (valor: unknown) => (typeof valor === "string" ? valor.trim() : "");
    try {
      if (corpo.tipo === "gitlab") {
        const credencial = texto(corpo.credencial);
        if (credencial === "" || !(await segredos.has(credencial)))
          return { status: 400, body: { error: "informe a credencial do token do GitLab, cadastrada no cofre" } };
        let host: string;
        try {
          host = hostDoServidor(texto(corpo.servidor));
        } catch (err) {
          return { status: 400, body: { error: err instanceof Error ? err.message : "servidor inválido" } };
        }
        const lista = await listarPessoasDoGitlab(host, texto(corpo.caminho), credencial);
        return { status: 200, body: lista };
      }
      if (corpo.tipo === "jira") {
        const credencial = texto(corpo.credencial);
        if (credencial === "" || !(await segredos.has(credencial)) || !texto(corpo.baseUrl) || !texto(corpo.email))
          return { status: 400, body: { error: "a Fonte Jira precisa de credencial do cofre, baseUrl e email" } };
        const lista = await listarPessoasDoJira(
          texto(corpo.baseUrl),
          texto(corpo.email),
          credencial,
          texto(corpo.projeto),
        );
        return { status: 200, body: lista };
      }
      if (corpo.tipo === "github") {
        if (!Number.isInteger(corpo.repoId)) return { status: 400, body: { error: "informe repoId do repositório" } };
        const app = await appChecker.status();
        if (!app.configurado || app.erro)
          return { status: 409, body: { error: app.erro ?? "GitHub App não configurado" } };
        const repo = catalogoDoApp(app).find((r) => r.id === corpo.repoId);
        if (!repo) return { status: 404, body: { error: `repositório ${corpo.repoId} não está no catálogo do App` } };
        return { status: 200, body: await listarPessoasDoGithub(repo.nome, repo.instalacaoId) };
      }
    } catch (err) {
      const motivo = err instanceof Error ? err.message : "falha ao consultar a Fonte";
      return { status: 502, body: { error: motivo } };
    }
    return { status: 400, body: { error: "tipo: use gitlab, github ou jira" } };
  }

  /** Lista de pessoas do GitLab do projeto, com o token do cofre. Falha de rede ou de resposta lança o erro. */
  async function listarPessoasDoGitlab(host: string, caminho: string, credencial: string): Promise<PessoaDaFonte[]> {
    return listarPessoasGitlab({
      host,
      caminho,
      token: (await segredos.get(credencial)) ?? "",
      fetch: opts.fetchGitlab ?? fetch,
    });
  }

  /** Lista de pessoas do Jira (usuários atribuíveis ao projeto), com o token do cofre. */
  async function listarPessoasDoJira(
    baseUrl: string,
    email: string,
    credencial: string,
    projeto: string,
  ): Promise<PessoaDaFonte[]> {
    return listarPessoasJira({
      baseUrl,
      email,
      token: (await segredos.get(credencial)) ?? "",
      projeto,
      fetch: opts.fetchFonte ?? fetch,
    });
  }

  /** Lista de responsáveis possíveis do repositório do GitHub App, pelo token da instalação. */
  async function listarPessoasDoGithub(repo: string, instalacaoId: number): Promise<PessoaDaFonte[]> {
    return pessoasDeAssignees(await appChecker.responsaveisPossiveis(repo, instalacaoId));
  }

  /**
   * Escolhas de PO e tech lead conferidas na Fonte antes de gravar (ticket 06). Sem escolha, não há consulta e o projeto
   * nasce incompleto. Fonte fora do ar responde 502; pessoa que a Fonte não conhece responde 400. Nos dois casos nada
   * é gravado.
   */
  async function conferirEscolhas(
    fonte: ProjectConfig["source"],
    escolhas: EscolhasPessoas | undefined,
    instalacaoId?: number,
  ): Promise<{ erro?: { status: number; body: unknown }; lista: PessoaDaFonte[] }> {
    if (escolhas?.po === undefined && escolhas?.techLead === undefined) return { lista: [] };
    if (fonte.type === "jira" && (!fonte.credential || !fonte.baseUrl || !fonte.email))
      return {
        erro: {
          status: 400,
          body: { error: "para escolher PO e tech lead, a Fonte Jira precisa de credencial, baseUrl e email" },
        },
        lista: [],
      };
    let lista: PessoaDaFonte[];
    try {
      if (fonte.type === "gitlab")
        lista = await listarPessoasDoGitlab(fonte.hostname ?? SERVIDOR_PADRAO, fonte.repo, fonte.credential ?? "");
      else if (fonte.type === "jira")
        lista = await listarPessoasDoJira(
          fonte.baseUrl ?? "",
          fonte.email ?? "",
          fonte.credential ?? "",
          fonte.project,
        );
      else if (instalacaoId === undefined) throw new Error("repositório sem instalação do GitHub App");
      else lista = await listarPessoasDoGithub(fonte.repo, instalacaoId);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : "falha ao consultar a Fonte";
      return { erro: { status: 502, body: { error: `${motivo}; o projeto não foi salvo` } }, lista: [] };
    }
    const erro = conferirEscolhasPessoas(escolhas, lista, fonte.type);
    return erro ? { erro: { status: 400, body: { error: erro } }, lista } : { lista };
  }

  async function criarProjetoClonado(projeto: {
    config: ProjectConfig;
    destino: string;
    clonar: () => Promise<void>;
    /** Dados extras do estado que só um tipo de repositório precisa (ex.: o plugue do catálogo do GitHub App). */
    ajustarEstado?: (state: FactoryState) => void;
  }): Promise<{ status: number; body: unknown }> {
    const { config, destino } = projeto;
    const conflitoDe = (existentes: ProjectConfig[], reservados: ReservaDeProjeto[]) =>
      conflitoProjeto(
        {
          nome: config.name,
          prefixo: config.source.project,
          fonteTipo: config.source.type,
          fonteRepo: "repo" in config.source ? config.source.repo : undefined,
        },
        existentes,
        reservados,
      );
    const existentesAgora = () => [...projects.values()].map((p) => p.config);

    try {
      await projeto.clonar();
    } catch (err) {
      return { status: 502, body: { error: redactSecrets(err instanceof Error ? err.message : "falha ao clonar") } };
    }

    let resposta: { status: number; body: unknown } = { status: 500, body: { error: "projeto não registrado" } };
    let registrar = false;
    await harness.commit(async (tx) => {
      const state = await tx.doc(StateDoc);
      const conflito = conflitoDe([...existentesAgora(), ...salvosDe(state)], projetosReservados(state));
      if (conflito) {
        resposta = { status: 409, body: { error: conflito } };
        return;
      }
      state.projetosGitHub = { ...state.projetosGitHub, [config.name]: JSON.stringify(config) };
      state.projetos = { ...state.projetos, [config.name]: JSON.stringify(config) };
      projeto.ajustarEstado?.(state);
      registrar = true;
      const pendencias = pendenciasDeConfiguracao(config);
      resposta = {
        status: 201,
        body: {
          projeto: config.name,
          repo: "repo" in config.source ? config.source.repo : undefined,
          prefixo: config.source.project,
          fonte: config.source.type,
          horario: config.activity,
          ensaio: config.dryRun,
          estado: estadoDoProjeto(pendencias),
          pendencias,
        },
      };
    }, context);
    if (registrar) registrarProjeto(config);
    else await rm(destino, { recursive: true, force: true });
    return resposta;
  }

  /**
   * Cria um projeto a partir de um repositório do catálogo do App (ADR-0016, ADR-0022). A Fonte e o horário vêm do
   * formulário; a fábrica clona o repositório em diretório gerenciado antes de gravar, e o projeto nasce incompleto
   * quando faltam PO, tech lead ou outros itens.
   */
  async function criarProjetoGithub(corpo: {
    repoId: number;
    nome: string;
    fonte: Record<string, unknown>;
    horario: "always" | "business-hours";
    ensaio: boolean;
    comandoTeste: string[];
    pessoas?: EscolhasPessoas;
  }): Promise<{ status: number; body: unknown }> {
    if (!opts.createSource) return { status: 409, body: { error: "este daemon não cria projetos pela interface" } };
    if (corpo.fonte.type === "gitlab")
      return { status: 400, body: { error: "a Fonte GitLab Issues é criada por caminho: use POST /projetos/gitlab" } };
    const referencia = opts.projects.find((p) => p.config.source.type === "github") ?? opts.projects[0];
    if (!referencia) return { status: 409, body: { error: "nenhum projeto no YAML para servir de padrão" } };
    const app = await appChecker.status();
    if (!app.configurado || app.erro) return { status: 409, body: { error: app.erro ?? "GitHub App não configurado" } };
    const repo = catalogoDoApp(app).find((r) => r.id === corpo.repoId);
    if (!repo) return { status: 404, body: { error: `repositório ${corpo.repoId} não está no catálogo do App` } };

    let config: ProjectConfig;
    try {
      config = montarProjetoGithub({
        padroes: padroesDe(referencia.config),
        repo: repo.nome,
        caminho: caminhoDoClone(corpo.nome),
        nome: corpo.nome,
        fonte: corpo.fonte,
        horario: corpo.horario,
        ensaio: corpo.ensaio,
        comandoTeste: corpo.comandoTeste,
      });
    } catch (err) {
      return { status: 400, body: { error: err instanceof Error ? err.message : "projeto inválido" } };
    }
    const erroFonte = await erroDaFonte(config.source);
    if (erroFonte) return { status: 400, body: { error: erroFonte } };
    const conflito = await conflitoAgora(config);
    if (conflito) return { status: 409, body: { error: conflito } };
    const pessoas = await conferirEscolhas(config.source, corpo.pessoas, repo.instalacaoId);
    if (pessoas.erro) return pessoas.erro;
    config = { ...config, ...pessoasDoProjeto(corpo.pessoas, config.source.type, pessoas.lista) };

    const destino = config.repositories?.[0]?.path ?? caminhoDoClone(config.name);
    return criarProjetoClonado({
      config,
      destino,
      clonar: () =>
        (opts.clonarRepositorio ?? ((c) => appChecker.clonar(c.repo, c.instalacaoId, c.destino)))({
          repo: repo.nome,
          instalacaoId: repo.instalacaoId,
          destino,
        }),
      ajustarEstado: (state) => {
        state.repos = {
          ...state.repos,
          [config.name]: { repo: repo.nome, status: "ativo", repoId: repo.id, installationId: repo.instalacaoId },
        };
      },
    });
  }

  /**
   * Cria um projeto a partir de um repositório GitLab informado por caminho completo (`grupo/projeto`) no servidor
   * dado (gitlab.com ou self-hosted). O token vem do cofre pelo nome da credencial, e o caminho é conferido com ele
   * antes de qualquer gravação: repositório inexistente ou token sem acesso são recusados com a causa.
   */
  async function criarProjetoGitlab(corpo: {
    nome: string;
    caminho: string;
    servidor: string;
    fonte: Record<string, unknown>;
    horario: "always" | "business-hours";
    ensaio: boolean;
    comandoTeste: string[];
    pessoas?: EscolhasPessoas;
  }): Promise<{ status: number; body: unknown }> {
    if (!opts.createSource) return { status: 409, body: { error: "este daemon não cria projetos pela interface" } };
    const referencia = opts.projects.find((p) => p.config.source.type === "github") ?? opts.projects[0];
    if (!referencia) return { status: 409, body: { error: "nenhum projeto no YAML para servir de padrão" } };
    const credencial = corpo.fonte.credential;
    if (typeof credencial !== "string" || credencial === "")
      return { status: 400, body: { error: "informe a credencial do token do GitLab (cadastrada no cofre)" } };

    let host: string;
    try {
      host = hostDoServidor(corpo.servidor);
    } catch (err) {
      return { status: 400, body: { error: err instanceof Error ? err.message : "servidor inválido" } };
    }
    let config: ProjectConfig;
    try {
      config = montarProjetoGithub({
        padroes: padroesDe(referencia.config),
        repo: corpo.caminho.trim(),
        caminho: caminhoDoClone(corpo.nome),
        nome: corpo.nome,
        fonte: {
          ...corpo.fonte,
          type: "gitlab",
          repo: corpo.caminho.trim(),
          ...(host === SERVIDOR_PADRAO ? {} : { hostname: host }),
        },
        horario: corpo.horario,
        ensaio: corpo.ensaio,
        comandoTeste: corpo.comandoTeste,
      });
    } catch (err) {
      return { status: 400, body: { error: err instanceof Error ? err.message : "projeto inválido" } };
    }
    const erroFonte = await erroDaFonte(config.source);
    if (erroFonte) return { status: 400, body: { error: erroFonte } };
    const conflito = await conflitoAgora(config);
    if (conflito) return { status: 409, body: { error: conflito } };

    const token = (await segredos.get(credencial)) ?? "";
    const caminho = corpo.caminho.trim();
    const erroRepo = await verificarRepositorioGitlab({
      host,
      caminho,
      token,
      fetch: opts.fetchGitlab ?? fetch,
    });
    if (erroRepo) return { status: 400, body: { error: erroRepo } };
    const pessoas = await conferirEscolhas(config.source, corpo.pessoas);
    if (pessoas.erro) return pessoas.erro;
    config = { ...config, ...pessoasDoProjeto(corpo.pessoas, "gitlab", pessoas.lista) };

    const destino = config.repositories?.[0]?.path ?? caminhoDoClone(config.name);
    return criarProjetoClonado({
      config,
      destino,
      clonar: () => (opts.clonarRepositorioGitlab ?? clonarRepositorioGitlab)({ host, caminho, token, destino }),
    });
  }

  /**
   * Pedido de importação. Só aceita repositório do catálogo do App com projeto configurado e ativo. Já em importação,
   * responde o registro atual sem enfileirar outra vez.
   */
  async function importarRepo(repoId: number): Promise<{ status: number; body: unknown }> {
    const app = await appChecker.status();
    if (!app.configurado || app.erro) return { status: 409, body: { error: app.erro ?? "GitHub App não configurado" } };
    const repo = catalogoDoApp(app).find((r) => r.id === repoId);
    if (!repo) return { status: 404, body: { error: `repositório ${repoId} não está no catálogo do App` } };
    const project = projectByRepo(repo.nome);
    if (!project) {
      return {
        status: 409,
        body: { error: `nenhum projeto monitora ${repo.nome}; configure o projeto no YAML primeiro` },
      };
    }
    // Importar cria Tarefas: projeto incompleto não executa, então não importa (ADR-0022).
    const pendencias = pendenciasBloqueantes(project, await readState());
    if (pendencias.length > 0) {
      return { status: 409, body: { error: `projeto ${project} incompleto: ${pendencias.join("; ")}` } };
    }
    let resposta: { status: number; body: unknown } = { status: 500, body: { error: "importação não registrada" } };
    let enfileirar = false;
    await harness.commit(async (tx) => {
      const state = await tx.doc(StateDoc);
      if (repoDesativado(state, project)) {
        resposta = { status: 409, body: { error: `o repositório ${repo.nome} está desplugado` } };
        return;
      }
      if (projetoPausado(state, project)) {
        resposta = { status: 409, body: { error: `projeto ${project} pausado: retome-o para importar` } };
        return;
      }
      const atual = state.importacoes?.[String(repoId)];
      if (atual?.status === "importando") {
        resposta = { status: 202, body: atual };
        return;
      }
      const registro = {
        repoId,
        repo: repo.nome,
        status: "importando" as const,
        installationId: repo.instalacaoId,
        ...(atual?.ultimaImportacaoEm ? { ultimaImportacaoEm: atual.ultimaImportacaoEm } : {}),
        ...(atual?.ultimoResultado ? { ultimoResultado: atual.ultimoResultado } : {}),
      };
      state.importacoes = { ...state.importacoes, [String(repoId)]: registro };
      resposta = { status: 202, body: registro };
      enfileirar = true;
    }, context);
    if (enfileirar) enfileirarImportacao(repoId);
    return resposta;
  }

  async function githubAppPanel(): Promise<GitHubAppPanel> {
    const state = await readState();
    const app = await appChecker.status();
    const repos = await listRepos();
    const ativos = repos.filter((r) => r.status === "ativo").map((r) => r.repo);
    const cobertos = cobertura(ativos, app.configurado && !app.erro ? app.instalacoes : undefined);
    return {
      receptor: {
        ligado: opts.webhook !== undefined,
        porta: opts.webhook?.port ?? null,
        ultimaEntregaEm: state.ultimoWebhookEm ?? null,
      },
      app,
      repositorios: repos.map((r) => ({
        projeto: r.project,
        repo: r.repo,
        status: r.status,
        coberto: r.status === "ativo" ? (cobertos.get(r.repo) ?? null) : null,
      })),
    };
  }

  /**
   * Desplugue: desativa o repositório de um projeto. Uma Tarefa ativa só para com `force`; sem ele, a resposta é 409 e
   * nada muda.
   */
  async function unplugRepo(repo: string, force: boolean): Promise<{ status: number; body: unknown }> {
    const project = projectByRepo(repo);
    if (!project) return { status: 404, body: { error: `nenhum projeto monitora ${repo}` } };
    const state = await readState();
    const ativas = tarefasAtivas(state, project).map((t) => t.id);
    if (ativas.length > 0 && !force)
      return {
        status: 409,
        body: {
          error: "há Tarefa em execução neste repositório; confirme com force para cancelá-la",
          tarefasAtivas: ativas,
        },
      };
    let effects: WebhookEffect[] = [];
    await harness.commit(async (tx) => {
      const current = await tx.doc(StateDoc);
      effects = desativarProjeto({ state: current, project, repo, motivo: "desplugado pelo usuário", force }).effects;
    }, context);
    await runWebhookEffects(effects);
    return { status: 200, body: { ok: true, project, repo, status: "desativado", tarefasCanceladas: ativas } };
  }

  /** Plugue: reativa um repositório já configurado (não cria projeto: a config fica no YAML, ADR-0010). */
  async function plugRepo(repo: string): Promise<{ status: number; body: unknown }> {
    const project = projectByRepo(repo);
    if (!project) return { status: 404, body: { error: `nenhum projeto monitora ${repo}; configure o YAML primeiro` } };
    await harness.commit(async (tx) => {
      ativarProjeto({ state: await tx.doc(StateDoc), project, repo });
    }, context);
    return { status: 200, body: { ok: true, project, repo, status: "ativo" } };
  }

  /** Altera uma Tarefa no estado durável. Retorna `false` se ela não existe. */
  async function updateTask(id: string, change: (task: QueuedTask, state: FactoryState) => void): Promise<boolean> {
    return harness.commit(async (tx) => {
      const state = await tx.doc(StateDoc);
      const task = state.tasks.find((t) => t.id === id);
      if (!task) return false;
      change(task, state);
      return true;
    }, context);
  }

  const TERMINAL = new Set(["concluida", "cancelada", "bloqueada", "vetada", "recusada"]);
  const commands: FactoryCommands = {
    async answerQuestion(id, n, answer) {
      if (!Number.isSafeInteger(n) || n < 1 || !answer.trim() || answer.length > 20_000) return false;
      const recorded = await harness.commit(async (tx) => {
        const state = await tx.doc(StateDoc);
        const task = state.tasks.find((t) => t.id === id);
        const q = task?.questions?.find((item) => item.n === n);
        if (
          !task ||
          !q ||
          !["aguardando-humano", "pausada"].includes(task.status) ||
          q.answer !== null ||
          q.publication === "sending"
        )
          return undefined;
        const resposta = answer.trim();
        const encaminhar = q.origin === "tecnica" && respostaNaoSei(resposta);
        if (q.purpose === "repositorio" && !encaminhar) {
          const mapping = repositoryFromAnswer(projectOf(task.project).config.repositories, resposta);
          // Texto vago, caminho arbitrário ou prefixo ambíguo não são resolução.
          if (!mapping) return undefined;
          task.repositoryPath = mapping.path;
        }
        if (encaminhar) {
          q.userResponse = resposta;
          q.needsForwarding = true;
        } else {
          recordAnswer(state, id, n, resposta);
          q.needsForwarding = false;
        }
        return {
          project: task.project,
          target: task.key,
          to: q.to,
          text: encaminhar ? resposta : q.text,
          status: encaminhar ? ("encaminhar" as const) : ("respondida" as const),
        };
      }, context);
      if (!recorded) return false;
      await events.append({ type: "question", ...recorded, n });
      if (recorded.status === "encaminhar") await forwardTechnical(id, n);
      react();
      return true;
    },
    pause: (id: string) =>
      updateTask(id, (task) => {
        if (TERMINAL.has(task.status)) return;
        task.pauseRequested = true;
        if (["enfileirada", "aguardando-entrega"].includes(task.status)) task.status = "pausada";
      }),
    resume: (id: string) =>
      updateTask(id, (task) => {
        task.pauseRequested = false;
        if (task.status === "pausada") task.status = "enfileirada";
        // O usuário corrigiu o ambiente: nova tentativa mede o baseline, sem aceitar o vermelho como TDD.
        if (blockedResumeKind(task as QueuedTask) === "baseline" && task.implementation) {
          task.implementation.baseline = null;
          task.durableId = null;
          task.gateId = null;
          task.reason = null;
          task.status = "enfileirada";
        }
        // TDD recusado no limite: quem retoma mudou o que impedia (config, formatador, ambiente). Novas tentativas na
        // mesma fase; os commits aceitos ficam.
        if (blockedResumeKind(task as QueuedTask) === "base-sync" && task.implementation) {
          if (task.implementation.synchronization?.status === "iniciada")
            task.implementation.synchronization.attempts = 0;
          task.durableId = null;
          task.gateId = null;
          task.reason = null;
          task.status = "enfileirada";
        }
        if (blockedResumeKind(task as QueuedTask) === "tdd" && task.implementation) {
          task.implementation.rejections = 0;
          task.implementation.feedback = null;
          task.durableId = null;
          task.gateId = null;
          task.reason = null;
          task.status = "enfileirada";
        }
      }),
    async cancel(id: string) {
      let durableId: number | null = null;
      const found = await updateTask(id, (task) => {
        if (TERMINAL.has(task.status)) return;
        if (task.durableId !== null) durableId = task.durableId;
        else task.status = "cancelada";
      });
      if (durableId !== null) await harness.abortTask(durableId as TaskId, context);
      return found;
    },
    async veto(id: string) {
      let result: VetoResult = "inexistente";
      let gate: number | null = null;
      await harness.commit(async (tx) => {
        const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === id);
        if (!task) return;
        // Só vale dentro do prazo: depois dele (mesmo antes de a Tarefa acordar), ela já segue para as etapas.
        if (task.status !== "aguardando-veto" || !task.veto || clock.now() >= task.veto.until) {
          result = "fora-do-prazo";
          return;
        }
        task.status = "vetada";
        task.reason = "vetada pelo usuário";
        gate = task.gateId;
        task.gateId = null;
        result = "vetada";
      }, context);
      // Acorda a Tarefa só para ela terminar, sem tocar no card.
      if (gate !== null) await harness.abortTask(gate as TaskId, context);
      return result;
    },
    pausarProjeto: (nome: string) =>
      harness.commit(async (tx) => {
        const state = await tx.doc(StateDoc);
        state.projetosPausados = [...new Set([...(state.projetosPausados ?? []), nome])];
      }, context),
    retomarProjeto: (nome: string) =>
      harness.commit(async (tx) => {
        const state = await tx.doc(StateDoc);
        state.projetosPausados = (state.projetosPausados ?? []).filter((p) => p !== nome);
        // Como no daemon: as Tarefas paradas só pela pausa do projeto voltam para a fila; as pausadas pelo usuário não.
        for (const t of state.tasks)
          if (t.project === nome && t.status === "pausada" && !t.pauseRequested) t.status = "enfileirada";
      }, context),
    setDaemonPaused: (paused: boolean) =>
      harness.commit(async (tx) => {
        const state = await tx.doc(StateDoc);
        state.daemonPaused = paused;
        // Ao retomar, as Tarefas paradas só pela pausa do daemon voltam para a fila.
        if (!paused)
          for (const t of state.tasks) if (t.status === "pausada" && !t.pauseRequested) t.status = "enfileirada";
      }, context),
    reorder: (ids: string[]) =>
      harness.commit(async (tx) => {
        const state = await tx.doc(StateDoc);
        const first = [...new Set(ids)]
          .map((id) => state.tasks.find((t) => t.id === id))
          .filter((t) => t !== undefined);
        state.tasks = [...first, ...state.tasks.filter((t) => !first.includes(t))];
      }, context),
  };

  // --- API HTTP ----------------------------------------------------------------------------------

  const json = (res: ServerResponse, status: number, body: unknown) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(payload);
  };
  const readBody = async (req: IncomingMessage): Promise<unknown> => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : undefined;
  };
  const streams = new Set<ServerResponse>();
  const approvingRetros = new Set<string>();
  let configuringRetro = false;
  const approvingQuestions = new Set<string>();

  /**
   * Só clientes locais: Host precisa ser localhost/127.0.0.1 na porta do servidor (barra DNS rebinding) e um POST com
   * Origin precisa vir dessas mesmas origens (barra CSRF de páginas abertas no navegador).
   */
  const localHosts = () => {
    const { port } = server.address() as AddressInfo;
    return new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  };
  const isLocalRequest = (req: IncomingMessage): boolean => {
    const hosts = localHosts();
    if (!hosts.has((req.headers.host ?? "").toLowerCase())) return false;
    const origin = req.headers.origin;
    if (req.method !== "POST" || origin === undefined) return true;
    return [...hosts].some((h) => origin.toLowerCase() === `http://${h}`);
  };
  const isJson = (req: IncomingMessage) =>
    (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() === "application/json";

  const server = createServer(async (req, res) => {
    try {
      // A página de gestão passa pela mesma proteção: só clientes locais.
      if (!isLocalRequest(req)) return json(res, 403, { error: "a API aceita só clientes locais" });
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = `${req.method} ${url.pathname}`;
      const taskCommand = url.pathname.match(/^\/tasks\/([^/]+)\/([^/]+)\/(pause|resume|cancel)$/);

      if (route === "GET /settings/retro")
        return json(res, 200, { repo: retroSettings.repo ?? null, available: Boolean(retroSettings.sink) });
      if (route === "POST /settings/retro") {
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const body = (await readBody(req)) as { repo?: unknown } | undefined;
        if (typeof body?.repo !== "string" || !isRetroRepository(body.repo.trim()))
          return json(res, 400, { error: "Informe o repositório no formato dono/nome, sem URL." });
        if (!retroSettings.sink) return json(res, 409, { error: "Adaptador de publicação indisponível neste daemon." });
        if (configuringRetro || approvingRetros.size > 0)
          return json(res, 409, { error: "Publicação ou configuração em andamento; tente novamente." });
        configuringRetro = true;
        try {
          const repo = body.repo.trim();
          await harness.commit(async (tx) => {
            (await tx.doc(StateDoc)).retroRepo = repo;
          }, context);
          retroSettings.repo = repo;
          return json(res, 200, { repo, available: true });
        } finally {
          configuringRetro = false;
        }
      }
      if (route === "GET /queue") return json(res, 200, await queue());
      if (route === "GET /tasks") return json(res, 200, (await readState()).tasks.map(taskSummary));
      const taskRoute = url.pathname.match(/^\/tasks\/([^/]+)\/([^/]+)$/);
      if (req.method === "GET" && taskRoute) {
        const id = `${decodeURIComponent(taskRoute[1] as string)}/${decodeURIComponent(taskRoute[2] as string)}`;
        const task = (await readState()).tasks.find((t) => t.id === id);
        return task
          ? json(res, 200, taskDetail(task, events.list()))
          : json(res, 404, { error: `Tarefa ${id} não existe` });
      }
      const traceRoute = url.pathname.match(/^\/tasks\/([^/]+)\/([^/]+)\/trace$/);
      if (req.method === "GET" && traceRoute) {
        const id = `${decodeURIComponent(traceRoute[1] as string)}/${decodeURIComponent(traceRoute[2] as string)}`;
        const task = (await readState()).tasks.find((t) => t.id === id);
        if (!task) return json(res, 404, { error: `Tarefa ${id} não existe` });
        return json(res, 200, await traceDaTarefa(harness, task, context));
      }
      const esquecerRoute = url.pathname.match(/^\/tasks\/([^/]+)\/([^/]+)\/etapas\/([^/]+)\/memoria\/esquecer$/);
      if (req.method === "POST" && esquecerRoute) {
        const id = `${decodeURIComponent(esquecerRoute[1] as string)}/${decodeURIComponent(esquecerRoute[2] as string)}`;
        const etapa = decodeURIComponent(esquecerRoute[3] as string);
        const task = (await readState()).tasks.find((t) => t.id === id);
        if (!task) return json(res, 404, { error: `Tarefa ${id} não existe` });
        // A implementação não entra aqui: as tools dela localizam a Tarefa pelo id da conversa, e zerá-lo quebraria a
        // retomada. SPEC, review e retrô têm caminho de nova conversa.
        const retroStage = etapa.startsWith("retro:") ? etapa.slice("retro:".length) : undefined;
        const atual =
          etapa === "spec"
            ? task.specConversationId
            : etapa === "review"
              ? task.review?.conversationId
              : retroStage
                ? task.retros?.find((r) => r.stage === retroStage)?.conversationId
                : undefined;
        if (etapa !== "spec" && etapa !== "review" && !retroStage)
          return json(res, 409, { error: `a etapa ${etapa} ainda não permite esquecer a memória` });
        if (!atual) return json(res, 409, { error: `a etapa ${etapa} ainda não tem memória para esquecer` });
        await harness.commit(async (tx) => {
          const alvo = (await tx.doc(StateDoc)).tasks.find((t) => t.id === id);
          if (!alvo) return;
          alvo.conversasEsquecidas = [...(alvo.conversasEsquecidas ?? []), atual];
          if (etapa === "spec") alvo.specConversationId = null;
          else if (etapa === "review" && alvo.review) alvo.review.conversationId = null;
          else if (retroStage) {
            const retro = alvo.retros?.find((r) => r.stage === retroStage);
            if (retro) retro.conversationId = null;
          }
        }, context);
        return json(res, 200, { etapa, esquecida: true });
      }
      const mensagemRoute = url.pathname.match(/^\/tasks\/([^/]+)\/([^/]+)\/etapas\/([^/]+)\/mensagem$/);
      if (req.method === "POST" && mensagemRoute) {
        const id = `${decodeURIComponent(mensagemRoute[1] as string)}/${decodeURIComponent(mensagemRoute[2] as string)}`;
        const etapa = decodeURIComponent(mensagemRoute[3] as string);
        const task = (await readState()).tasks.find((t) => t.id === id);
        if (!task) return json(res, 404, { error: `Tarefa ${id} não existe` });
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const corpo = (await readBody(req)) as { texto?: unknown } | undefined;
        if (typeof corpo?.texto !== "string" || corpo.texto.trim() === "")
          return json(res, 400, { error: "informe texto, a mensagem para o agente" });
        const conversa = [...conversasDaTarefa(task)].find(([, nome]) => nome === etapa)?.[0];
        if (!conversa) return json(res, 404, { error: `a etapa ${etapa} ainda não tem conversa nesta tarefa` });
        const handle = await harness.conversation(conversa, context);
        if (!handle) return json(res, 404, { error: `a conversa da etapa ${etapa} não existe mais` });
        // Com a etapa em execução, a mensagem vira steer no próximo ponto de decisão; parada, inicia um turno novo.
        await handle.submit(
          {
            type: "input",
            content: corpo.texto.trim(),
            requestId: `usuario-${globalThis.crypto.randomUUID()}`,
            whenBusy: "steer",
          },
          context,
        );
        return json(res, 200, { etapa, enviada: true });
      }
      const repairRoute = url.pathname.match(/^\/tasks\/([^/]+)\/([^/]+)\/repair$/);
      if (repairRoute && (req.method === "GET" || req.method === "POST")) {
        const project = decodeURIComponent(repairRoute[1] as string);
        const key = decodeURIComponent(repairRoute[2] as string);
        const id = `${project}/${key}`;
        const task = (await readState()).tasks.find((t) => t.id === id);
        if (!task) return json(res, 404, { error: "tarefa inexistente" });
        if (req.method === "GET") return json(res, 200, await repairPreview(task, implementationDeps.worktreesRoot));
        if (!isJson(req)) return json(res, 400, { error: "envie JSON" });
        const body = (await readBody(req)) as { revision?: unknown; approveTestChanges?: unknown } | undefined;
        if (
          typeof body?.revision !== "string" ||
          !/^[0-9a-f]{64}$/.test(body.revision) ||
          body.approveTestChanges !== true
        )
          return json(res, 400, {
            error: "exige revisão exata e aprovação explícita dos reparos, inclusive nos testes",
          });
        const revision = body.revision;
        const result = await harness.commit(async (tx) => {
          const current = (await tx.doc(StateDoc)).tasks.find((t) => t.id === id);
          if (!current) throw new RepairConflict("tarefa inexistente");
          return integrateRepair(
            current as QueuedTask,
            implementationDeps.worktreesRoot,
            revision,
            implementationDeps.testRunner,
            context.abortSignal,
          );
        }, context);
        await events.append({
          type: "progress",
          project,
          target: key,
          message: `Reparo humano aprovado e validado para o ticket ${result.ticket + 1}: commit ${result.sha.slice(0, 8)}. Tarefa continua bloqueada até retomada explícita.`,
        });
        return json(res, 200, result);
      }
      const triageRoute = url.pathname.match(/^\/tasks\/([^/]+)\/([^/]+)\/triage(\/decide)?$/);
      if (triageRoute && (req.method === "GET" || req.method === "POST")) {
        const [, encodedProject, encodedKey, deciding] = triageRoute;
        if ((req.method === "POST") !== (deciding !== undefined)) return json(res, 404, { error: "rota inexistente" });
        const projectName = decodeURIComponent(encodedProject as string);
        const cardKey = decodeURIComponent(encodedKey as string);
        const id = `${projectName}/${cardKey}`;
        const task = (await readState()).tasks.find((t) => t.id === id);
        if (!task?.triage) return json(res, 404, { error: "triagem não encontrada" });
        if (task.triage.review !== "draft" || task.status !== "aguardando-humano")
          return json(res, 409, { error: "triagem não está aguardando decisão" });
        const project = projectOf(projectName);
        const { result } = task.triage;
        const preview = {
          card: cardKey,
          verdict: result.verdict,
          category: result.category,
          reason: result.reason,
          by: result.by,
          duplicateOf: result.duplicateOf ?? null,
          // O que sai na issue se o usuário recusar: o comentário exato e o motivo do fechamento.
          comment: withAutomationMark(redactSecrets(refusalComment(result, duplicateRef(result)))),
          closeAs: closeReason(result),
          dryRun: project.config.dryRun,
        };
        const revision = reviewRevision(preview);
        if (req.method === "GET") return json(res, 200, { ...preview, revision });
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const body = (await readBody(req)) as { revision?: unknown; decision?: unknown } | undefined;
        if (body?.decision !== "aceitar" && body?.decision !== "recusar")
          return json(res, 400, { error: 'decision deve ser "aceitar" ou "recusar"' });
        if (body.revision !== revision) return json(res, 409, { error: "prévia alterada; revise novamente" });
        if (project.config.dryRun && body.decision === "recusar")
          return json(res, 409, { error: "publicação real desativada no dry-run" });
        const decision = body.decision;
        const decided = await harness.commit(async (tx) => {
          const current = (await tx.doc(StateDoc)).tasks.find((t) => t.id === id);
          if (current?.status !== "aguardando-humano" || current.triage?.review !== "draft") return false;
          current.triage.review = decision;
          current.status = current.pauseRequested ? "pausada" : "enfileirada";
          return true;
        }, context);
        return decided ? json(res, 200, { ok: true }) : json(res, 409, { error: "triagem mudou ou foi cancelada" });
      }
      const specRoute = url.pathname.match(/^\/tasks\/([^/]+)\/([^/]+)\/spec(\/approve)?$/);
      if (specRoute && (req.method === "GET" || req.method === "POST")) {
        const [, encodedProject, encodedKey, approval] = specRoute;
        if ((req.method === "POST") !== (approval !== undefined)) return json(res, 404, { error: "rota inexistente" });
        const projectName = decodeURIComponent(encodedProject as string);
        const cardKey = decodeURIComponent(encodedKey as string);
        const id = `${projectName}/${cardKey}`;
        const state = await readState();
        const task = state.tasks.find((t) => t.id === id);
        if (!task?.delivery) return json(res, 404, { error: "SPEC não encontrada" });
        if (task.specReview !== "draft" || task.status !== "aguardando-humano")
          return json(res, 409, { error: "SPEC não está disponível para aprovação" });
        const project = projectOf(projectName);
        const preview = {
          card: cardKey,
          spec: withAutomationMark(redactSecrets(`SPEC\n\n${task.delivery.spec}`)),
          tickets: withAutomationMark(redactSecrets(`Tickets\n\n${renderTickets(task.delivery.tickets)}`)),
          dryRun: project.config.dryRun,
        };
        const revision = reviewRevision(preview);
        if (req.method === "GET") return json(res, 200, { ...preview, revision });
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const body = (await readBody(req)) as { revision?: unknown } | undefined;
        if (body?.revision !== revision) return json(res, 409, { error: "prévia alterada; revise novamente" });
        // Aprovação é local; o escritor continua responsável por suprimir efeitos no dry-run.
        const approved = await harness.commit(async (tx) => {
          const current = (await tx.doc(StateDoc)).tasks.find((t) => t.id === id);
          if (current?.status !== "aguardando-humano" || current.specReview !== "draft") return false;
          current.specReview = "approved";
          current.specApprovedDryRun = project.config.dryRun;
          current.status = current.pauseRequested ? "pausada" : "enfileirada";
          return true;
        }, context);
        return approved ? json(res, 200, { ok: true }) : json(res, 409, { error: "SPEC mudou ou foi cancelada" });
      }
      const reminderRoute = url.pathname.match(/^\/tasks\/([^/]+)\/([^/]+)\/questions\/(\d+)\/reminder(\/approve)?$/);
      if (reminderRoute && (req.method === "GET" || req.method === "POST")) {
        const [, encodedProject, encodedKey, number, approval] = reminderRoute;
        if ((req.method === "POST") !== (approval !== undefined)) return json(res, 404, { error: "rota inexistente" });
        const projectName = decodeURIComponent(encodedProject as string);
        const cardKey = decodeURIComponent(encodedKey as string);
        const id = `${projectName}/${cardKey}`;
        const n = Number(number);
        const state = await readState();
        const task = state.tasks.find((t) => t.id === id);
        const q = task?.questions?.find((item) => item.n === n);
        if (!q) return json(res, 404, { error: "pergunta não encontrada" });
        if (q.reminder !== "draft" || q.answer !== null || task?.status !== "aguardando-humano")
          return json(res, 409, { error: "lembrete não está disponível para aprovação" });
        const project = projectOf(projectName);
        const text = reminderText(q);
        const preview = {
          card: cardKey,
          to: q.to,
          comment: withAutomationMark(redactSecrets(`${project.source.formatMention(q.to)} ${text}`)),
          dryRun: project.config.dryRun,
        };
        const revision = reviewRevision(preview);
        if (req.method === "GET") return json(res, 200, { ...preview, revision });
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const body = (await readBody(req)) as { revision?: unknown } | undefined;
        if (body?.revision !== revision) return json(res, 409, { error: "prévia alterada; revise novamente" });
        if (project.config.dryRun) return json(res, 409, { error: "publicação real desativada no dry-run" });
        const reserved = await harness.commit(async (tx) => {
          const current = (await tx.doc(StateDoc)).tasks.find((t) => t.id === id);
          const stored = current?.questions?.find((item) => item.n === n);
          if (current?.status !== "aguardando-humano" || stored?.reminder !== "draft" || stored.answer !== null)
            return false;
          stored.reminder = "sending";
          return true;
        }, context);
        if (!reserved) return json(res, 409, { error: "lembrete mudou ou já foi enviado" });
        try {
          await project.channel.remind(q.ref, text);
        } catch (err) {
          if (!(err instanceof GuardrailViolation)) throw err;
          await markQuestion(id, n, (stored) => {
            stored.reminder = "draft";
          });
          return json(res, 409, { error: `publicação barrada: ${err.message}` });
        }
        await markQuestion(id, n, (stored) => {
          stored.reminder = "sent";
        });
        await events.append({
          type: "question",
          project: projectName,
          target: cardKey,
          n,
          to: q.to,
          text: q.text,
          status: "lembrete",
        });
        return json(res, 200, { ok: true });
      }
      const answerRoute = url.pathname.match(/^\/tasks\/([^/]+)\/([^/]+)\/questions\/(\d+)\/answer$/);
      if (answerRoute && req.method === "POST") {
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const body = (await readBody(req)) as { answer?: unknown } | undefined;
        if (typeof body?.answer !== "string" || !body.answer.trim() || body.answer.length > 20_000)
          return json(res, 400, { error: "resposta deve ter entre 1 e 20000 caracteres" });
        const project = decodeURIComponent(answerRoute[1] as string);
        const key = decodeURIComponent(answerRoute[2] as string);
        const n = Number(answerRoute[3]);
        const id = `${project}/${key}`;
        const task = (await readState()).tasks.find((t) => t.id === id);
        if (!task?.questions?.some((q) => q.n === n)) return json(res, 404, { error: "pergunta não encontrada" });
        // Web e Telegram usam a mesma classificação e o mesmo despertar atômico.
        const ok = await commands.answerQuestion?.(id, n, body.answer.trim());
        return ok
          ? json(res, 200, { ok: true })
          : json(res, 409, { error: "pergunta não está disponível para resposta" });
      }
      const questionRoute = url.pathname.match(/^\/tasks\/([^/]+)\/([^/]+)\/questions\/(\d+)(\/approve)?$/);
      if (questionRoute && (req.method === "GET" || req.method === "POST")) {
        const [, encodedProject, encodedKey, number, approval] = questionRoute;
        if ((req.method === "POST") !== (approval !== undefined)) return json(res, 404, { error: "rota inexistente" });
        const projectName = decodeURIComponent(encodedProject as string);
        const cardKey = decodeURIComponent(encodedKey as string);
        const id = `${projectName}/${cardKey}`;
        const n = Number(number);
        const lock = `${id}/${n}`;
        if (approvingQuestions.has(lock)) return json(res, 409, { error: "pergunta já está sendo publicada" });
        if (req.method === "POST") approvingQuestions.add(lock);
        try {
          const state = await readState();
          const task = state.tasks.find((t) => t.id === id);
          const q = task?.questions?.find((item) => item.n === n);
          if (!q) return json(res, 404, { error: "pergunta não encontrada" });
          if (q.publication !== "draft" || task?.status !== "aguardando-humano")
            return json(res, 409, { error: "pergunta não está disponível para aprovação" });
          const project = projectOf(projectName);
          const po = pessoasDoPapel(project.config, "po").find((p) => p.id === q.to);
          if (!po) return json(res, 409, { error: "destinatário não está configurado" });
          const link = project.config.source.baseUrl
            ? `${project.config.source.baseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(cardKey)}`
            : undefined;
          const preview = {
            card: cardKey,
            to: q.to,
            comment: withAutomationMark(
              redactSecrets(`${project.source.formatMention(q.to)} Pergunta ${n}: ${q.text}`),
            ),
            teamsUserId: avisoTeamsDe(po) ?? null,
            teamsMessage:
              avisoTeamsDe(po) && link
                ? teamsQuestionMessage({ card: cardKey, title: task?.title ?? "", link, name: po.name })
                : null,
            dryRun: project.config.dryRun,
          };
          const revision = questionRevision(preview);
          if (req.method === "GET") return json(res, 200, { ...preview, revision });
          if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
          const body = (await readBody(req)) as { revision?: unknown } | undefined;
          if (body?.revision !== revision) return json(res, 409, { error: "prévia alterada; revise novamente" });
          if (project.config.dryRun) return json(res, 409, { error: "publicação real desativada no dry-run" });
          if (state.daemonPaused || task.pauseRequested) return json(res, 409, { error: "tarefa ou daemon pausado" });
          if (avisoTeamsDe(po) && (!link || !opts.teams)) return json(res, 409, { error: "Teams indisponível" });
          const reserved = await harness.commit(async (tx) => {
            const currentState = await tx.doc(StateDoc);
            const current = currentState.tasks.find((t) => t.id === id);
            const currentQuestion = current?.questions?.find((item) => item.n === n);
            if (
              currentState.daemonPaused ||
              (current && projetoPausado(currentState, current.project)) ||
              current?.status !== "aguardando-humano" ||
              current.pauseRequested ||
              currentQuestion?.publication !== "draft" ||
              currentQuestion.text !== q.text ||
              currentQuestion.to !== q.to
            )
              return false;
            currentQuestion.publication = "sending";
            return true;
          }, context);
          if (!reserved) return json(res, 409, { error: "pergunta mudou ou foi cancelada" });
          let ref: Awaited<ReturnType<Channel["ask"]>>;
          try {
            ref = await project.channel.ask({ card: cardKey, to: q.to, text: `Pergunta ${n}: ${q.text}` });
          } catch (err) {
            // Guardrail barra antes de escrever: nada saiu, a pergunta volta a rascunho. Outro erro é incerto.
            if (!(err instanceof GuardrailViolation)) throw err;
            await markQuestion(id, n, (stored) => {
              stored.publication = "draft";
            });
            return json(res, 409, { error: `publicação barrada: ${err.message}` });
          }
          const askedAt = clock.now();
          await markQuestion(id, n, (stored) => {
            stored.ref = ref;
            stored.askedAt = askedAt;
            stored.remindAt = addBusinessHours(project.config.calendar, askedAt, REMINDER_BUSINESS_HOURS);
            stored.notifyAt = addBusinessHours(project.config.calendar, askedAt, workdayHours(project.config.calendar));
            stored.teamsNotice =
              avisoTeamsDe(po) && link ? { userId: avisoTeamsDe(po) as string, link, status: "pending" } : undefined;
            stored.publication = "sent";
          });
          await sendTeamsNotice(id, projectName, cardKey, n);
          await events.append({
            type: "question",
            project: projectName,
            target: cardKey,
            n,
            to: q.to,
            text: q.text,
            status: "enviada",
          });
          return json(res, 200, { ok: true });
        } finally {
          if (req.method === "POST") approvingQuestions.delete(lock);
        }
      }
      const retroRoute = url.pathname.match(
        /^\/tasks\/([^/]+)\/([^/]+)\/retros\/(triagem|spec|implementacao|review|mr|tarefa)\/(\d+)(\/approve)?$/,
      );
      if (retroRoute && (req.method === "GET" || req.method === "POST")) {
        const [, encodedProject, encodedKey, stage, number, approval] = retroRoute;
        if ((req.method === "POST") !== (approval !== undefined)) return json(res, 404, { error: "rota inexistente" });
        const projectName = decodeURIComponent(encodedProject as string);
        const cardKey = decodeURIComponent(encodedKey as string);
        const taskId = `${projectName}/${cardKey}`;
        const lock = `${taskId}/${stage}/${number}`;
        if (configuringRetro || approvingRetros.has(lock) || (req.method === "POST" && approvingRetros.size > 0))
          return json(res, 409, { error: "uma proposta já está sendo publicada; tente novamente" });
        if (req.method === "POST") approvingRetros.add(lock);
        try {
          const task = (await readState()).tasks.find((t) => t.id === taskId);
          const retro = task?.retros?.find((r) => r.stage === stage);
          const proposal = retro?.proposals?.find((p) => p.n === Number(number));
          if (!task || !retro || !proposal || proposal.kind !== "fabrica")
            return json(res, 404, { error: "proposta não encontrada" });
          if (retro.status !== "concluida" || proposal.status !== "pendente" || !task.ref)
            return json(res, 409, { error: "proposta não está disponível para revisão" });
          if (!retroSettings.sink || !retroSettings.repo)
            return json(res, 409, { error: "repositório da fábrica não configurado" });
          const project = projectOf(projectName);
          const publication = {
            writer: project.writer,
            cardKey,
            config: project.config,
            sink: retroSettings.sink,
            repo: retroSettings.repo,
            stage: retro.stage,
            ref: task.ref,
            proposal,
          };
          const preview = await previewFactoryRetro(publication);
          if (req.method === "GET")
            return json(res, 200, {
              title: preview.title,
              body: preview.body,
              revision: preview.revision,
              repo: publication.repo,
              dryRun: project.config.dryRun,
              blocked: preview.blocked,
            });
          if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
          const body = (await readBody(req)) as { revision?: unknown } | undefined;
          if (body?.revision !== preview.revision)
            return json(res, 409, { error: "prévia alterada; revise novamente" });
          if (preview.blocked)
            return json(res, 409, { error: "texto ainda contém valores privados; publicação bloqueada" });
          await publishFactoryRetro(publication, preview);
          await harness.commit(async (tx) => {
            const current = (await tx.doc(StateDoc)).tasks
              .find((t) => t.id === taskId)
              ?.retros?.find((r) => r.stage === stage)
              ?.proposals?.find((p) => p.n === Number(number));
            if (current?.status === "pendente") Object.assign(current, proposal);
          }, context);
          return json(res, 200, { ok: true, status: proposal.status, issue: proposal.issue });
        } finally {
          if (req.method === "POST") approvingRetros.delete(lock);
        }
      }
      if (route === "POST /poll") {
        await serializedPoll();
        return json(res, 200, { ok: true });
      }
      if (route === "POST /tasks/order") {
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const body = (await readBody(req)) as { ids?: unknown };
        if (!Array.isArray(body?.ids)) return json(res, 400, { error: "envie { ids: string[] }" });
        await commands.reorder(body.ids.map(String));
        return json(res, 200, { ok: true });
      }
      const vetoCommand = url.pathname.match(/^\/tasks\/([^/]+)\/([^/]+)\/veto$/);
      if (req.method === "POST" && vetoCommand) {
        const [, project, key] = vetoCommand as unknown as [string, string, string];
        const id = `${decodeURIComponent(project)}/${decodeURIComponent(key)}`;
        const result = await commands.veto(id);
        if (result === "inexistente") return json(res, 404, { error: `Tarefa ${id} não existe` });
        if (result === "fora-do-prazo")
          return json(res, 409, { error: `Tarefa ${id} não está aguardando veto (o prazo já passou ou não houve)` });
        return json(res, 200, { ok: true, status: "vetada" });
      }
      if (req.method === "POST" && taskCommand) {
        const [, project, key, command] = taskCommand as unknown as [
          string,
          string,
          string,
          "pause" | "resume" | "cancel",
        ];
        const id = `${decodeURIComponent(project)}/${decodeURIComponent(key)}`;
        const found = await commands[command](id);
        return found ? json(res, 200, { ok: true }) : json(res, 404, { error: `Tarefa ${id} não existe` });
      }
      const pendenciasMatch = url.pathname.match(/^\/projetos\/([^/]+)\/pendencias$/);
      if (pendenciasMatch && req.method === "GET") {
        const nome = decodeURIComponent(pendenciasMatch[1] ?? "");
        const guardada = lerConfiguracao((await readState()).projetos?.[nome]);
        if (!guardada) return json(res, 404, { error: `projeto ${nome} não existe` });
        return json(res, 200, comConfirmacaoPendente(pendenciasDeConfiguracao(guardada), await readState(), nome));
      }
      const estadoMatch = url.pathname.match(/^\/projetos\/([^/]+)\/estado$/);
      if (estadoMatch && req.method === "GET") {
        const nome = decodeURIComponent(estadoMatch[1] ?? "");
        const guardada = lerConfiguracao((await readState()).projetos?.[nome]);
        if (!guardada) return json(res, 404, { error: `projeto ${nome} não existe` });
        const state = await readState();
        const pendencias = comConfirmacaoPendente(pendenciasDeConfiguracao(guardada), state, nome);
        const pausado = projetoPausado(state, nome);
        return json(res, 200, {
          estado: estadoDoProjeto(pendencias, pausado),
          pendencias,
          aguardandoConfirmacao: aguardandoConfirmacao(state, nome),
        });
      }
      const pausaMatch = url.pathname.match(/^\/projetos\/([^/]+)\/(pausa|retomada)$/);
      if (pausaMatch && req.method === "POST") {
        const nome = decodeURIComponent(pausaMatch[1] ?? "");
        const guardada = lerConfiguracao((await readState()).projetos?.[nome]);
        if (!guardada) return json(res, 404, { error: `projeto ${nome} não existe` });
        const pendencias = comConfirmacaoPendente(pendenciasDeConfiguracao(guardada), await readState(), nome);
        if (pausaMatch[2] === "pausa") {
          // Só um projeto ativo se pausa: um incompleto já não executa (ADR-0022).
          if (pendencias.length > 0)
            return json(res, 409, { error: `projeto ${nome} incompleto: ${pendencias.join("; ")}` });
          await commands.pausarProjeto(nome);
        } else {
          // Retomar revalida a configuração: volta a ativo só sem pendências; senão segue pausado com o que falta.
          if (pendencias.length > 0)
            return json(res, 409, { error: `projeto ${nome} incompleto: ${pendencias.join("; ")}` });
          await commands.retomarProjeto(nome);
        }
        const pausado = projetoPausado(await readState(), nome);
        return json(res, 200, { estado: estadoDoProjeto(pendencias, pausado), pendencias });
      }
      const confirmacaoMatch = url.pathname.match(/^\/projetos\/([^/]+)\/confirmacao$/);
      if (confirmacaoMatch && req.method === "POST") {
        const nome = decodeURIComponent(confirmacaoMatch[1] ?? "");
        const guardada = lerConfiguracao((await readState()).projetos?.[nome]);
        if (!guardada) return json(res, 404, { error: `projeto ${nome} não existe` });
        // Confirmar a Fonte nova tira só a pendência da troca: o projeto vira ativo se não houver outras (e não pausado).
        await harness.commit(async (tx) => {
          const state = await tx.doc(StateDoc);
          state.projetosAguardandoConfirmacao = (state.projetosAguardandoConfirmacao ?? []).filter((p) => p !== nome);
        }, context);
        const state = await readState();
        const pendencias = comConfirmacaoPendente(pendenciasDeConfiguracao(guardada), state, nome);
        return json(res, 200, {
          estado: estadoDoProjeto(pendencias, projetoPausado(state, nome)),
          pendencias,
          aguardandoConfirmacao: false,
        });
      }
      const remocaoMatch = url.pathname.match(/^\/projetos\/([^/]+)\/remocao$/);
      if (remocaoMatch && req.method === "POST") {
        const nome = decodeURIComponent(remocaoMatch[1] ?? "");
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const corpo = (await readBody(req)) as { confirmar?: unknown } | undefined;
        if (!(await readState()).projetos?.[nome]) return json(res, 404, { error: `projeto ${nome} não existe` });
        // Remover é irreversível: o nome do projeto precisa ser repetido no corpo, como confirmação explícita.
        if (corpo?.confirmar !== nome)
          return json(res, 400, { error: `confirme a remoção enviando "confirmar" com o nome do projeto: ${nome}` });
        let emAndamento: string[] = [];
        let removido = false;
        await harness.commit(async (tx) => {
          const state = await tx.doc(StateDoc);
          if (!state.projetos?.[nome]) return;
          // Com Tarefa em andamento, nada muda: a remoção só sai quando o projeto não tem nenhuma (ticket 11).
          emAndamento = tarefasEmAndamento(state, nome).map((t) => t.id);
          if (emAndamento.length > 0) return;
          const guardada = lerConfiguracao(state.projetos[nome]);
          removido = true;
          state.projetos = semProjeto(state.projetos, nome);
          state.projetosGitHub = semProjeto(state.projetosGitHub, nome);
          state.repos = semProjeto(state.repos, nome);
          state.sincronizadoEm = semProjeto(state.sincronizadoEm, nome);
          state.projetosPausados = (state.projetosPausados ?? []).filter((p) => p !== nome);
          state.projetosAguardandoConfirmacao = (state.projetosAguardandoConfirmacao ?? []).filter((p) => p !== nome);
          state.projetosRemovidos = {
            ...state.projetosRemovidos,
            [nome]: { prefixo: guardada?.source.project ?? "", quando: new Date(clock.now()).toISOString() },
          };
          // Dentro do commit: nenhuma Tarefa nova entra no projeto entre a gravação e a saída da memória.
          projects.delete(nome);
          bases.delete(nome);
          criadosPelaInterface.delete(nome);
        }, context);
        if (emAndamento.length > 0)
          return json(res, 409, {
            error: `há tarefas em andamento no projeto ${nome}: conclua ou cancele-as para remover o projeto`,
            tarefasEmAndamento: emAndamento,
          });
        if (!removido) return json(res, 404, { error: `projeto ${nome} não existe` });
        const reserva = projetosReservados(await readState()).find((r) => r.nome === nome);
        return json(res, 200, { removido: nome, prefixoReservado: reserva?.prefixo ?? null });
      }
      if (route === "GET /telegram/configuracao") {
        const salvo = (await readState()).telegramConfig;
        return salvo ? json(res, 200, salvo) : json(res, 404, { error: "Telegram não configurado" });
      }
      if (route === "PUT /telegram/configuracao") {
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const corpo = (await readBody(req)) as { chat?: unknown; credential?: unknown; usuario?: unknown } | undefined;
        if (typeof corpo?.chat !== "string" || !/^-?\d+$/.test(corpo.chat.trim()))
          return json(res, 400, { error: "informe chat, o id numérico da conversa do bot" });
        if (typeof corpo.usuario !== "string" || !/^\d+$/.test(corpo.usuario.trim()))
          return json(res, 400, {
            error: "informe usuario, o id numérico do usuário autorizado a falar com a fábrica",
          });
        const credential = typeof corpo.credential === "string" ? corpo.credential.trim() : undefined;
        if (credential !== undefined && !(await segredos.has(credential)))
          return json(res, 400, { error: `credencial ${credential} não cadastrada` });
        const configTelegram = {
          chat: corpo.chat.trim(),
          usuario: corpo.usuario.trim(),
          ...(credential ? { credential } : {}),
        };
        await harness.commit(async (tx) => {
          (await tx.doc(StateDoc)).telegramConfig = configTelegram;
        }, context);
        await reiniciarBridge();
        return json(res, 200, configTelegram);
      }
      const historicoMatch = url.pathname.match(/^\/projetos\/([^/]+)\/historico$/);
      if (historicoMatch && req.method === "GET") {
        const nome = decodeURIComponent(historicoMatch[1] ?? "");
        const state = await readState();
        if (!lerConfiguracao(state.projetos?.[nome])) return json(res, 404, { error: `projeto ${nome} não existe` });
        return json(res, 200, state.historicoConfig?.[nome] ?? []);
      }
      const segredoMatch = url.pathname.match(/^\/segredos\/([^/]+)$/);
      if (route === "GET /segredos") return json(res, 200, await segredos.list());
      if (route === "GET /ferramentas") return json(res, 200, catalogoDeFerramentas());
      if (segredoMatch && req.method === "PUT") {
        const nomeSegredo = decodeURIComponent(segredoMatch[1] ?? "");
        if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(nomeSegredo))
          return json(res, 400, { error: "nome: use minúsculas, números e hífen (2 a 64 caracteres)" });
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const corpo = (await readBody(req)) as { valor?: unknown } | undefined;
        if (typeof corpo?.valor !== "string" || corpo.valor.length === 0)
          return json(res, 400, { error: "informe valor, o conteúdo da credencial" });
        // Credencial em uso por projetos: a troca passa pelo mesmo teste de conexão do PUT da Fonte Jira
        // (um valor inválido não deve degradar as tarefas em silêncio) e fica registrada no histórico.
        const usadoPor: { nome: string; fonte: { type: string; baseUrl?: string; email?: string } }[] = [];
        for (const [nome, bruto] of Object.entries((await readState()).projetos ?? {})) {
          const config = lerConfiguracao(bruto);
          if (config?.source.credential === nomeSegredo) usadoPor.push({ nome, fonte: config.source });
        }
        for (const { fonte } of usadoPor) {
          if (fonte.type !== "jira" || !fonte.baseUrl || !fonte.email) continue;
          const conexao = await testarConexaoJira({
            baseUrl: fonte.baseUrl,
            email: fonte.email,
            token: corpo.valor,
            fetch: opts.fetchFonte ?? fetch,
          });
          if (!conexao.ok)
            return json(res, 400, {
              error: `conexão com o Jira falhou (${conexao.motivo}); a credencial ${nomeSegredo} não foi trocada`,
            });
        }
        const gravado = await segredos.put(nomeSegredo, corpo.valor);
        // A interface do Telegram lê o token ao ligar: trocar a credencial do bot religa a interface na hora.
        if ((await readState()).telegramConfig?.credential === nomeSegredo) await reiniciarBridge();
        if (usadoPor.length > 0) {
          await harness.commit(async (tx) => {
            const state = await tx.doc(StateDoc);
            const quando = new Date(clock.now()).toISOString();
            const historico = { ...state.historicoConfig };
            for (const { nome } of usadoPor)
              historico[nome] = [
                ...(historico[nome] ?? []),
                { quando, autor: "usuario", campos: [`credencial ${nomeSegredo} trocada`] },
              ];
            state.historicoConfig = historico;
          }, context);
        }
        return json(res, 200, gravado);
      }
      const configuracaoMatch = url.pathname.match(/^\/projetos\/([^/]+)\/configuracao$/);
      if (configuracaoMatch && req.method === "GET") {
        const nome = decodeURIComponent(configuracaoMatch[1] ?? "");
        const guardada = lerConfiguracao((await readState()).projetos?.[nome]);
        return guardada ? json(res, 200, guardada) : json(res, 404, { error: `projeto ${nome} não existe` });
      }
      if (configuracaoMatch && req.method === "PUT") {
        const nome = decodeURIComponent(configuracaoMatch[1] ?? "");
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const lida = ProjectConfig.safeParse(await readBody(req));
        if (!lida.success)
          return json(res, 400, {
            error: lida.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          });
        if (lida.data.name !== nome) return json(res, 400, { error: "o nome do projeto no corpo não bate com a URL" });
        const errosPerfis = validarPerfis({ profiles: lida.data.profiles, people: lida.data.people });
        if (errosPerfis.length > 0) return json(res, 400, { error: errosPerfis[0] });
        for (const repositorio of lida.data.repositories ?? []) {
          if (!(await ehDiretorio(repositorio.path)))
            return json(res, 400, { error: `caminho do repositório não existe: ${repositorio.path}` });
        }
        const erroFonte = await erroDaFonte(lida.data.source);
        if (erroFonte) return json(res, 400, { error: erroFonte });
        let existe = false;
        let emAndamento: string[] = [];
        await harness.commit(async (tx) => {
          const state = await tx.doc(StateDoc);
          const anterior = lerConfiguracao(state.projetos?.[nome]);
          if (!anterior) return;
          existe = true;
          // Trocar a Fonte ou o repositório só sem tarefas em andamento (ticket 10): nada é gravado se houver.
          const troca = trocouFonteOuRepositorio(anterior, lida.data);
          if (troca) {
            emAndamento = tarefasEmAndamento(state, nome).map((t) => t.id);
            if (emAndamento.length > 0) return;
            state.projetosAguardandoConfirmacao = [...new Set([...(state.projetosAguardandoConfirmacao ?? []), nome])];
          }
          state.projetos = { ...state.projetos, [nome]: JSON.stringify(lida.data) };
          const campos = camposAlterados(anterior, lida.data);
          if (campos.length > 0)
            state.historicoConfig = {
              ...state.historicoConfig,
              [nome]: [
                ...(state.historicoConfig?.[nome] ?? []),
                { quando: new Date(clock.now()).toISOString(), autor: "usuario", campos },
              ],
            };
        }, context);
        if (!existe) return json(res, 404, { error: `projeto ${nome} não existe` });
        if (emAndamento.length > 0)
          return json(res, 409, {
            error: `há tarefas em andamento no projeto ${nome}: conclua ou cancele-as para trocar a Fonte ou o repositório`,
            tarefasEmAndamento: emAndamento,
          });
        aplicarConfiguracao(lida.data);
        return json(res, 200, lida.data);
      }
      if (route === "GET /projetos")
        return json(
          res,
          200,
          [...projects.values()].map((p) => ({
            nome: p.config.name,
            fonte: p.config.source.type,
            ensaio: p.config.dryRun,
          })),
        );
      if (route === "GET /integracoes/canais")
        return json(res, 200, [
          ...canais.tipos().map((tipo) => ({ tipo, papel: "conversa", rotulo: rotulosCanais[tipo] ?? tipo })),
          ...canaisDeAviso.tipos().map((tipo) => ({ tipo, papel: "aviso", rotulo: rotulosCanais[tipo] ?? tipo })),
        ]);
      if (route === "GET /integracoes/fontes") return json(res, 200, [ESQUEMA_JIRA, ESQUEMA_GITHUB, ESQUEMA_GITLAB]);
      if (route === "GET /perfis/modelos") return json(res, 200, PERFIS_PRONTOS);
      if (route === "GET /repos") return json(res, 200, await listRepos());
      if (route === "GET /github-app") return json(res, 200, await githubAppPanel());
      if (route === "GET /github/repos") return json(res, 200, await githubReposCatalog());
      if (route === "POST /projetos/github") {
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const body = (await readBody(req)) as
          | {
              repoId?: unknown;
              nome?: unknown;
              fonte?: unknown;
              horario?: unknown;
              ensaio?: unknown;
              comandoTeste?: unknown;
              pessoas?: unknown;
            }
          | undefined;
        if (
          !Number.isInteger(body?.repoId) ||
          typeof body?.nome !== "string" ||
          typeof body?.fonte !== "object" ||
          body.fonte === null ||
          Array.isArray(body.fonte)
        )
          return json(res, 400, { error: "informe repoId, nome e a fonte (objeto com type e os campos dela)" });
        if (body.horario !== undefined && body.horario !== "business-hours" && body.horario !== "always")
          return json(res, 400, { error: "horario: use business-hours (horário comercial) ou always (sempre ativo)" });
        const comando = Array.isArray(body.comandoTeste)
          ? body.comandoTeste.map((item) => (typeof item === "string" ? item.trim() : ""))
          : [];
        // Sem comando nenhum o projeto nasce incompleto (ticket 08); um item vazio no meio do argv é erro de digitação.
        if (comando.some((item) => item === ""))
          return json(res, 400, { error: "comando de teste: cada argumento precisa ter texto" });
        const result = await criarProjetoGithub({
          repoId: body.repoId as number,
          nome: body.nome.trim(),
          fonte: body.fonte as Record<string, unknown>,
          horario: body.horario === "always" ? "always" : "business-hours",
          ensaio: body.ensaio !== false,
          comandoTeste: comando,
          pessoas: lerEscolhasPessoas(body.pessoas),
        });
        return json(res, result.status, result.body);
      }
      if (route === "POST /projetos/gitlab") {
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const body = (await readBody(req)) as
          | {
              nome?: unknown;
              caminho?: unknown;
              servidor?: unknown;
              fonte?: unknown;
              horario?: unknown;
              ensaio?: unknown;
              comandoTeste?: unknown;
              pessoas?: unknown;
            }
          | undefined;
        if (
          typeof body?.nome !== "string" ||
          typeof body?.caminho !== "string" ||
          typeof body?.fonte !== "object" ||
          body.fonte === null ||
          Array.isArray(body.fonte)
        )
          return json(res, 400, { error: "informe nome, caminho (grupo/projeto), servidor e a fonte (objeto)" });
        if (body.servidor !== undefined && typeof body.servidor !== "string")
          return json(res, 400, { error: "servidor: informe a URL do GitLab como texto" });
        if (body.horario !== undefined && body.horario !== "business-hours" && body.horario !== "always")
          return json(res, 400, { error: "horario: use business-hours (horário comercial) ou always (sempre ativo)" });
        const comando = Array.isArray(body.comandoTeste)
          ? body.comandoTeste.map((item) => (typeof item === "string" ? item.trim() : ""))
          : [];
        // Sem comando nenhum o projeto nasce incompleto (ticket 08); um item vazio no meio do argv é erro de digitação.
        if (comando.some((item) => item === ""))
          return json(res, 400, { error: "comando de teste: cada argumento precisa ter texto" });
        const result = await criarProjetoGitlab({
          nome: body.nome.trim(),
          caminho: body.caminho,
          servidor: body.servidor ?? "",
          fonte: body.fonte as Record<string, unknown>,
          horario: body.horario === "always" ? "always" : "business-hours",
          ensaio: body.ensaio !== false,
          comandoTeste: comando,
          pessoas: lerEscolhasPessoas(body.pessoas),
        });
        return json(res, result.status, result.body);
      }
      if (route === "POST /projetos/pessoas-da-fonte") {
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const result = await listarPessoasParaCriacao(await readBody(req));
        return json(res, result.status, result.body);
      }
      if (route === "POST /github/importar") {
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const body = (await readBody(req)) as { repoId?: unknown } | undefined;
        if (!Number.isInteger(body?.repoId) || (body?.repoId as number) <= 0)
          return json(res, 400, { error: "informe repoId, o id numérico do repositório no GitHub" });
        const result = await importarRepo(body?.repoId as number);
        return json(res, result.status, result.body);
      }
      if (route === "POST /repos/plugar" || route === "POST /repos/desplugar") {
        if (!isJson(req)) return json(res, 415, { error: "envie Content-Type: application/json" });
        const body = (await readBody(req)) as { repo?: unknown; force?: unknown } | undefined;
        if (typeof body?.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(body.repo.trim()))
          return json(res, 400, { error: "informe o repositório no formato dono/nome" });
        const repo = body.repo.trim();
        const result =
          route === "POST /repos/plugar" ? await plugRepo(repo) : await unplugRepo(repo, body.force === true);
        return json(res, result.status, result.body);
      }
      if (route === "GET /daemon") return json(res, 200, { paused: (await readState()).daemonPaused });
      if (route === "POST /daemon/pause" || route === "POST /daemon/resume") {
        await commands.setDaemonPaused(route.endsWith("pause"));
        return json(res, 200, { ok: true });
      }
      if (route === "GET /events") return json(res, 200, events.list());
      if (route === "GET /events/stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": conectado\n\n");
        streams.add(res);
        const unsubscribe = events.subscribe((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
        req.on("close", () => {
          unsubscribe();
          streams.delete(res);
        });
        return;
      }
      if (route === "GET /openapi.json") return json(res, 200, API_SCHEMA);
      const page = req.method === "GET" ? await webFile(url.pathname) : undefined;
      if (page) {
        res.writeHead(200, page.headers);
        res.end(page.body);
        return;
      }
      json(res, 404, { error: "rota inexistente" });
    } catch (err) {
      json(res, err instanceof RepairConflict ? 409 : 500, { error: redactSecrets(String(err)) });
    }
  });

  /** Uma busca por vez, venha ela do timer ou da API. */
  let polling: Promise<void> = Promise.resolve();
  let pendingPolls = 0;
  function serializedPoll(): Promise<void> {
    pendingPolls++;
    const run = polling.then(poll).finally(() => pendingPolls--);
    polling = run.catch(() => undefined);
    return run;
  }
  /** Uma tarefa de sincronização na mesma fila das buscas: nunca roda ao mesmo tempo que elas. */
  function serializedTask(task: () => Promise<void>): Promise<void> {
    const run = polling.then(task);
    polling = run.catch(() => undefined);
    return run;
  }
  // Sincronização de startup (ADR-0015): recupera o que o webhook perdeu enquanto o daemon esteve fora.
  void serializedTask(reconcileRepos).catch((err) =>
    console.error("[fábrica] sincronização de startup falhou:", redactSecrets(String(err))),
  );
  // Importações que o daemon deixou em `importando` (ele caiu no meio) voltam para a fila; a escrita é uma só, então
  // rodar de novo não duplica nada.
  void readState()
    .then((state) => {
      for (const registro of Object.values(state.importacoes ?? {})) {
        if (registro.status === "importando") enfileirarImportacao(registro.repoId);
      }
    })
    .catch((err) => console.error("[fábrica] retomada das importações falhou:", redactSecrets(String(err))));
  // O timer pula o tick se ainda houver busca pendente, para não acumular buscas com a Fonte lenta.
  const pollTimer =
    opts.pollIntervalMs &&
    setInterval(() => {
      if (pendingPolls > 0) return;
      serializedPoll().catch((err) => console.error("[fábrica] erro na busca:", err));
    }, opts.pollIntervalMs);

  // --- Interface de gestão ------------------------------------------------------------------------

  /** Interface de gestão salva pela API (fatia 09): o token sai do cofre; só vale com usuário e credencial. */
  async function interfaceDeGestaoSalva(): Promise<
    { port: ManagementInterface; chat: string; user: string } | undefined
  > {
    const salvo = (await readState()).telegramConfig;
    if (!salvo?.credential || !opts.criarInterfaceTelegram) return undefined;
    const token = await segredos.get(salvo.credential);
    if (!token) return undefined;
    return { port: opts.criarInterfaceTelegram(token, salvo.chat), chat: salvo.chat, user: salvo.usuario };
  }
  // Variáveis de ambiente, quando definidas, têm prioridade sobre a configuração salva.
  async function montarBridge(management: { port: ManagementInterface; chat: string; user?: string } | undefined) {
    return (
      management &&
      (await startManagementBridge({
        ...management,
        events,
        initialEventCount,
        progress: {
          load: async () => {
            const stored = (await harness.snapshot(ManagementDoc, context))?.[management.port.name];
            return stored && { ...stored };
          },
          save: (progress) =>
            harness.commit(async (tx) => {
              (await tx.doc(ManagementDoc))[management.port.name] = progress;
            }, context),
        },
        tasks: async () => (await readState()).tasks,
        commands,
        content: (project) => projects.get(project)?.config.telegram?.content ?? "full",
        contextLabel: (name) => (projects.get(name)?.config.activity === "business-hours" ? "Empresa" : "Pessoal"),
        availableAt: (name) => {
          const config = projects.get(name)?.config;
          return config ? nextProjectActivity(config, clock.now()) : clock.now();
        },
        now: clock.now,
        armTimer,
      }))
    );
  }
  let bridge = await montarBridge(opts.management ?? (await interfaceDeGestaoSalva()));
  /** Telegram salvo pela API vale sem reiniciar; a variável de ambiente (opts.management) continua prioritária. */
  async function reiniciarBridge(): Promise<void> {
    if (opts.management) return;
    const anterior = bridge;
    bridge = undefined;
    await anterior?.stop();
    bridge = await montarBridge(await interfaceDeGestaoSalva());
  }

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
    plugRepo,
    unplugRepo,
    githubAppPanel,
    githubReposCatalog,
    importarRepo,
    close: async () => {
      closing = true;
      await avisos.flush();
      await bridge?.stop();
      await webhookListener?.close();
      if (pollTimer) clearInterval(pollTimer);
      disarmRetry?.();
      for (const stream of streams) stream.end();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await polling;
      await reacting;
      observation.detach();
      await harness.close(context);
    },
  };
}
