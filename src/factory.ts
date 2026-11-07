import { mkdir, readFile, realpath } from "node:fs/promises";
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
import { API_SCHEMA } from "./api-schema.js";
import { addBusinessHours, nextProjectActivity, workdayHours } from "./business-hours.js";
import { type Channel, createCardCommentChannel } from "./channel.js";
import type { CodeHost } from "./code-host.js";
import type { CardState, ProjectConfig } from "./config.js";
import { runDelivery } from "./delivery-stage.js";
import type { DemandSource } from "./demand-source.js";
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
import type { EventRecorder, FactoryEvent, NewEvent } from "./events.js";
import { git } from "./git.js";
import { gitCodeHost } from "./git-code-host.js";
import {
  baselineBlockedReason,
  baselineWorkspaceBlockedReason,
  createImplementationExtension,
  runImplementation,
  StageBlocked,
} from "./implement-stage.js";
import { type ManagementInterface, startManagementBridge } from "./management.js";
import { findClosingCommit, findMergedWork, recentSubjects } from "./prior-work.js";
import { questionRevision, reviewRevision, teamsQuestionMessage } from "./question-review.js";
import { resolveRepository } from "./repo-resolver.js";
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
import { taskDetail, taskEvents, taskSummary } from "./task-view.js";
import type { TeamsNotifier } from "./teams-mcp.js";
import { createHostTestRunner, type TestRunner } from "./test-runner.js";
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
  reorder(ids: string[]): Promise<void>;
  /** Responde localmente sem publicar na Fonte; false se a pergunta não está disponível. */
  answerQuestion?(id: string, n: number, answer: string): Promise<boolean>;
}

export interface RunningFactory {
  url: string;
  /** Os mesmos comandos da API, para as interfaces de gestão no processo do daemon. */
  commands: FactoryCommands;
  close(): Promise<void>;
}

/** Estados em que a fábrica assume um card. */
const ELIGIBLE: ReadonlySet<CardState> = new Set(["todo", "in_progress"]);

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
  /** Interface de gestão (Telegram) e a conversa/usuário de onde ela aceita comandos. Sem ela, a fábrica só tem a API. */
  management?: { port: ManagementInterface; chat: string; user?: string };
  /**
   * Issues da fábrica (RetroSink) e o repositório **público** da fábrica (`dono/nome`) onde as retrôs abrem issues.
   * Sem `repo`, as propostas da fábrica ficam só registradas na Tarefa.
   */
  retro?: { sink?: RetroSink; repo?: string };
}): Promise<RunningFactory> {
  const retryDelayMs = opts.retryDelayMs ?? 60_000;
  const clock: FactoryClock = opts.clock ?? { now: Date.now };
  /** Um timer do agendador no relógio da fábrica. */
  const armTimer = (callback: () => void, delayMs: number): (() => void) => {
    const disarm = clock.setTimer?.(callback, delayMs, { background: false });
    if (disarm) return disarm;
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  };
  let events!: DurableEventLog;
  if (!opts.retro?.sink || !opts.retro.repo)
    console.warn(
      "[fábrica] retrô sem repositório da fábrica: defina FACTORY_RETRO_REPO=dono/nome para abrir issues; " +
        "as propostas da fábrica ficam só registradas nas Tarefas.",
    );
  const eventRecorder: EventRecorder = { append: (e) => events.append(e), list: () => events.list() };
  const projects = new Map(
    opts.projects.map((p) => {
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
          const base =
            progress.defaultBranch ??
            (await git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim().replace(/^origin\//, "");
          return (
            draft.base === base &&
            (await git(cwd, ["rev-parse", "HEAD"])).trim() === task.review.head &&
            task.review.head === progress.head
          );
        },
        retro: opts.retro,
      });
      const channel: Channel = createCardCommentChannel({ source: p.source, writer });
      return [p.config.name, { ...p, codeHost, writer, channel }] as const;
    }),
  );
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
          const outcome = await runDelivery({
            taskId: input.id,
            runtime,
            config: project.config,
            codeHost: project.codeHost,
            writer,
            worktreesRoot: implementationDeps.worktreesRoot,
          });
          const publication = (await readState()).tasks.find((t) => t.id === input.id)?.publication;
          if (publication)
            await progressOnce(`PR/MR ${publication.status}${publication.url ? `: ${publication.url}` : ""}`);
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
        await implement();
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

      async function implement(): Promise<void> {
        const current = (await readState()).tasks.find((t) => t.id === input.id);
        if (!current?.delivery) throw new Error(`a etapa SPEC não deixou Tickets para ${input.key}`);
        const card = await source.getCard(input.key);
        if (!card) throw new Error(`card ${input.key} não existe mais`);
        await runImplementation({
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
          model: project.config.roles.implementer ?? project.config.roles.spec,
          deps: implementationDeps,
          tools: implementationTools,
        });
      }

      async function progressOnce(message: string): Promise<void> {
        const last = events
          .list()
          .filter((e) => e.type === "progress" && e.project === input.project && e.target === input.key)
          .at(-1);
        if (last?.type !== "progress" || last.message !== message)
          await events.append({ type: "progress", project: input.project, target: input.key, message });
      }

      async function reviewLoop(feedback: { id: string; body: string; author: string }[] = []): Promise<void> {
        for (;;) {
          const verdict = await runReview({
            harness,
            runtime,
            taskId: input.id,
            config: project.config,
            worktreesRoot: implementationDeps.worktreesRoot,
            tools: reviewTools,
            feedback,
          });
          const reviewed = (await readState()).tasks.find((t) => t.id === input.id)?.review;
          await events.append({
            type: "progress",
            project: input.project,
            target: input.key,
            message: `Review ${verdict ?? "concluído"}${reviewed ? ` do HEAD ${reviewed.head.slice(0, 8)}: ${reviewed.summary.slice(0, 400)}` : ""}`,
          });
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
          model: project.config.roles.spec,
          context: runtime.context,
          requestId: `spec-${questions.length}`,
          exclude: await triageConversations(),
          input: specInput({
            card,
            comments,
            attachments,
            knowledge: await readKnowledge(project.knowledgeDir),
            answered,
          }),
          followUp: last && questions.at(-1)?.origin === "grill" ? answerFollowUp(last) : undefined,
        });
        if (outcome.kind === "question") {
          await ask(questions, outcome.text, "grill");
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
      async function triageConversations(): Promise<string[]> {
        const conversation = (await readState()).tasks.find((t) => t.id === input.id)?.triageConversation;
        return conversation ? [String(conversation)] : [];
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
          model: project.config.roles.retro ?? project.config.roles.spec,
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
      async function ask(previous: Question[], text: string, origin: Question["origin"]): Promise<void> {
        const po = project.config.people.find((p) => p.role === "po");
        if (!po)
          throw new StageBlocked(`o grill precisa perguntar ao PO, mas o projeto ${input.project} não declara um`);
        if (po.teamsUserId && (!project.config.source.baseUrl || !opts.teams))
          throw new StageBlocked("aviso ao PO no Teams configurado sem origem Jira ou conexão MCP");
        if (previous.length >= MAX_PO_QUESTIONS)
          throw new StageBlocked(
            `o grill já fez ${MAX_PO_QUESTIONS} perguntas ao PO e ainda quer perguntar: "${text}"`,
          );
        const n = previous.length + 1;
        const ref = project.config.questionApproval
          ? { card: input.key, to: po.id, before: [] }
          : await project.channel.ask({ card: input.key, to: po.id, text: `Pergunta ${n}: ${text}` });
        const askedAt = clock.now();
        const { calendar } = project.config;
        const question: Question = {
          n,
          origin,
          to: po.id,
          text,
          ref,
          askedAt,
          remindAt: addBusinessHours(calendar, askedAt, REMINDER_BUSINESS_HOURS),
          notifyAt: addBusinessHours(calendar, askedAt, workdayHours(calendar)),
          reminded: false,
          notified: false,
          answer: null,
          ...(project.config.questionApproval ? { publication: "draft" as const } : {}),
          ...(po.teamsUserId && project.config.source.baseUrl && !project.config.dryRun
            ? {
                teamsNotice: {
                  userId: po.teamsUserId,
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
        if (project.config.questionApproval) return;
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
      if (state.daemonPaused || !task || task.pauseRequested || !["ativa", "aguardando-humano"].includes(task.status))
        return undefined;
      const q = task.questions?.find((item) => item.n === n);
      if (q?.teamsNotice?.status !== "pending" || q.answer !== null) return undefined;
      if (!config.people.some((p) => p.role === "po" && p.id === q.to && p.teamsUserId === q.teamsNotice?.userId))
        return undefined;
      q.teamsNotice.status = "attempted";
      const po = config.people.find((p) => p.role === "po" && p.id === q.to);
      return { userId: q.teamsNotice.userId, link: q.teamsNotice.link, title: task.title, name: po?.name };
    }, context);
    if (!notice) return;
    try {
      await opts.teams.send({
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
    for (const { config, source } of projects.values()) {
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
        recordAnswer(state, id, n, answer.trim());
        return { project: task.project, target: task.key, to: q.to, text: q.text };
      }, context);
      if (!recorded) return false;
      await events.append({ type: "question", ...recorded, n, status: "respondida" });
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
        if (
          task.status === "bloqueada" &&
          task.stage === "implementacao" &&
          task.implementation &&
          task.implementation.commits.length === 0 &&
          ((task.implementation.baseline === "vermelha" &&
            task.reason === baselineBlockedReason(task.implementation.branch)) ||
            (task.implementation.baseline === null &&
              task.reason === baselineWorkspaceBlockedReason(task.implementation.branch)))
        ) {
          task.implementation.baseline = null;
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
          comment: withAutomationMark(redactSecrets(text)),
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
        const answer = body.answer.trim();
        const recorded = await harness.commit(async (tx) => {
          const state = await tx.doc(StateDoc);
          const task = state.tasks.find((t) => t.id === `${project}/${key}`);
          const q = task?.questions?.find((item) => item.n === n);
          if (!task || !q) return { code: 404, error: "pergunta não encontrada" };
          if (
            !["aguardando-humano", "pausada"].includes(task.status) ||
            q.answer !== null ||
            q.publication === "sending"
          )
            return { code: 409, error: "pergunta não está disponível para resposta" };
          recordAnswer(state, task.id, n, answer);
          return { code: 200, to: q.to, text: q.text };
        }, context);
        if (recorded.code !== 200) return json(res, recorded.code, { error: recorded.error });
        await events.append({
          type: "question",
          project,
          target: key,
          n,
          to: recorded.to as string,
          text: recorded.text as string,
          status: "respondida",
        });
        react();
        return json(res, 200, { ok: true });
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
          const po = project.config.people.find((p) => p.role === "po" && p.id === q.to);
          if (!po) return json(res, 409, { error: "destinatário não está configurado" });
          const link = project.config.source.baseUrl
            ? `${project.config.source.baseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(cardKey)}`
            : undefined;
          const preview = {
            card: cardKey,
            to: q.to,
            comment: withAutomationMark(redactSecrets(`Pergunta ${n}: ${q.text}`)),
            teamsUserId: po.teamsUserId ?? null,
            teamsMessage:
              po.teamsUserId && link
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
          if (po.teamsUserId && (!link || !opts.teams)) return json(res, 409, { error: "Teams indisponível" });
          const reserved = await harness.commit(async (tx) => {
            const currentState = await tx.doc(StateDoc);
            const current = currentState.tasks.find((t) => t.id === id);
            const currentQuestion = current?.questions?.find((item) => item.n === n);
            if (
              currentState.daemonPaused ||
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
              po.teamsUserId && link ? { userId: po.teamsUserId, link, status: "pending" } : undefined;
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
        if (approvingRetros.has(lock) || (req.method === "POST" && approvingRetros.size > 0))
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
          if (!opts.retro?.sink || !opts.retro.repo)
            return json(res, 409, { error: "repositório da fábrica não configurado" });
          const project = projectOf(projectName);
          const publication = {
            writer: project.writer,
            cardKey,
            config: project.config,
            sink: opts.retro.sink,
            repo: opts.retro.repo,
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
              repo: opts.retro.repo,
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
      json(res, 500, { error: String(err) });
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
  // O timer pula o tick se ainda houver busca pendente, para não acumular buscas com a Fonte lenta.
  const pollTimer =
    opts.pollIntervalMs &&
    setInterval(() => {
      if (pendingPolls > 0) return;
      serializedPoll().catch((err) => console.error("[fábrica] erro na busca:", err));
    }, opts.pollIntervalMs);

  // --- Interface de gestão ------------------------------------------------------------------------

  const management = opts.management;
  const bridge =
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
    }));

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    commands,
    close: async () => {
      closing = true;
      await bridge?.stop();
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
