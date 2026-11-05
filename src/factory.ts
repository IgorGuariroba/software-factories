import { mkdir, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
  type TaskId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { API_SCHEMA } from "./api-schema.js";
import { addBusinessHours, workdayHours } from "./business-hours.js";
import { type Channel, createCardCommentChannel } from "./channel.js";
import type { CodeHost } from "./code-host.js";
import type { CardState, ProjectConfig } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import {
  copyOutOfCommit,
  createTarefaTask,
  DeadlineGateTask,
  EventEntry,
  eventToJson,
  type FactoryState,
  GateTask,
  ManagementDoc,
  pendingQuestion,
  type Question,
  type QueuedTask,
  RETRO_STEP,
  type RetroStage,
  recordAnswer,
  StateDoc,
} from "./durable.js";
import { createEffectWriter, type EffectWriter, GuardrailViolation } from "./effect-writer.js";
import type { EventRecorder, FactoryEvent, NewEvent } from "./events.js";
import { gitCodeHost } from "./git-code-host.js";
import { createImplementationExtension, runImplementation, StageBlocked } from "./implement-stage.js";
import { type ManagementInterface, startManagementBridge } from "./management.js";
import type { RetroSink } from "./retro-sink.js";
import { newTaskRef, RetroExtension, runRetro } from "./retro-stage.js";
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
import { createHostTestRunner, type TestRunner } from "./test-runner.js";
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
  // O link público de uma Tarefa leva só o id opaco; a página local resolve o id (`#/retro/<id>`).
  let baseUrl = `http://127.0.0.1:${opts.port ?? 0}`;
  const retroLinkPrefix = () => `${baseUrl}/#/retro/`;
  if (!opts.retro?.sink || !opts.retro.repo)
    console.warn(
      "[fábrica] retrô sem repositório da fábrica: defina FACTORY_RETRO_REPO=dono/nome para abrir issues; " +
        "as propostas da fábrica ficam só registradas nas Tarefas.",
    );
  const eventRecorder: EventRecorder = { append: (e) => events.append(e), list: () => events.list() };
  const projects = new Map(
    opts.projects.map((p) => {
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
        retro: { ...opts.retro, linkPrefix: retroLinkPrefix },
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
  const projectOf = (name: string) => {
    const project = projects.get(name);
    if (!project) throw new Error(`Projeto ${name} não está configurado`);
    return project;
  };

  const Tarefa = createTarefaTask({
    retryDelayMs,
    async run(input, step, runtime) {
      const project = projectOf(input.project);
      const { writer, source } = project;
      if (step === "comentar") {
        await writer.commentOnce(input.key, "Assumindo este card.");
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
      if (step === RETRO_STEP.spec) return retro("spec");
      if (step === RETRO_STEP.implementacao) return retro("implementacao");
      if (step === RETRO_STEP.tarefa) return retro("tarefa");

      // Uma tentativa anterior já obteve a entrega: republica a mesma, sem chamar o modelo de novo.
      let delivery: SpecDelivery | undefined;
      await runtime.commit(async (tx) => {
        const stored = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id)?.delivery;
        delivery = stored ? copyOutOfCommit(stored) : undefined;
      });

      if (step === "implementar") {
        if (!delivery) throw new Error(`a etapa SPEC não deixou Tickets para ${input.key}`);
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
          delivery,
          model: project.config.roles.implementer ?? project.config.roles.spec,
          deps: implementationDeps,
          tools: implementationTools,
        });
        return undefined;
      }

      if (!delivery) {
        const outcome = await grill();
        if (outcome === "aguardar") return "aguardar";
        delivery = outcome;
      }
      await writer.upsertComment(input.key, "SPEC", delivery.spec);
      await writer.upsertComment(input.key, "Tickets", renderTickets(delivery.tickets));
      return undefined;

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
        const delivered = outcome.delivery;
        await runtime.commit(async (tx) => {
          const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
          if (task) task.delivery = delivered;
        });
        return delivered;
      }

      /** A retrô de uma etapa de modelo, ou a consolidada. A implementação que não rodou não tem retrô. */
      async function retro(stage: RetroStage): Promise<undefined> {
        const task = (await readState()).tasks.find((t) => t.id === input.id);
        if (!task || (stage === "implementacao" && !task.implementation)) return undefined;
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
          linkFor: (ref) => `${retroLinkPrefix()}${ref}`,
        });
        return undefined;
      }

      /** Leva a pergunta ao PO pelo Canal e a registra com os prazos de escalonamento em horas úteis. */
      async function ask(previous: Question[], text: string, origin: Question["origin"]): Promise<void> {
        const po = project.config.people.find((p) => p.role === "po");
        if (!po)
          throw new StageBlocked(`o grill precisa perguntar ao PO, mas o projeto ${input.project} não declara um`);
        if (previous.length >= MAX_PO_QUESTIONS)
          throw new StageBlocked(
            `o grill já fez ${MAX_PO_QUESTIONS} perguntas ao PO e ainda quer perguntar: "${text}"`,
          );
        const n = previous.length + 1;
        const ref = await project.channel.ask({ card: input.key, to: po.id, text: `Pergunta ${n}: ${text}` });
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
        };
        await runtime.commit(async (tx) => {
          const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
          if (task && !task.questions?.some((q) => q.n === n)) task.questions = [...(task.questions ?? []), question];
        });
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
      let question: Question | undefined;
      await runtime.commit(async (tx) => {
        const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === input.id);
        const pending = task && pendingQuestion(task);
        question = pending ? copyOutOfCommit(pending) : undefined;
      });
      if (!question) return null;
      const q = question;
      if (await checkAnswer(input, q)) return null;

      const now = runtime.now();
      if (!q.reminded && now >= q.remindAt) {
        await project.channel.remind(
          q.ref,
          `Lembrete da pergunta ${q.n}: ainda aguardo a sua resposta neste card. ${q.text}`,
        );
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
      err instanceof GuardrailViolation || err instanceof StageBlocked
        ? { kind: "blocked", reason: err.message }
        : { kind: "error", message: err instanceof Error ? err.message : String(err) },
    onError: (input, message) => events.append({ type: "error", project: input.project, target: input.key, message }),
  });

  const registry = createRegistry();
  registry.install(defineExtension({ name: "fabrica", tasks: [Tarefa, GateTask, DeadlineGateTask] }));
  registry.install(SpecExtension);
  registry.install(RetroExtension);
  registry.install(implementationTools.extension);
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

  // --- Perguntas -------------------------------------------------------------------------------

  /** Altera uma pergunta registrada no estado durável. */
  async function markQuestion(id: string, n: number, change: (q: Question) => void): Promise<void> {
    await harness.commit(async (tx) => {
      const question = (await tx.doc(StateDoc)).tasks.find((t) => t.id === id)?.questions?.find((q) => q.n === n);
      if (question) change(question);
    }, context);
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
      if (pending) await checkAnswer(task, pending);
    }
  }

  // --- Fila ------------------------------------------------------------------------------------

  /** Cards elegíveis na Fonte agora. */
  async function queue(): Promise<QueueItem[]> {
    const items: QueueItem[] = [];
    for (const { config, source } of projects.values()) {
      for (const card of await source.listAssignedCards(config.source.assignee)) {
        const state = config.statuses[card.status];
        if (card.assignee !== config.source.assignee || !state || !ELIGIBLE.has(state)) continue;
        items.push({ project: config.name, key: card.key, title: card.title, status: card.status, state });
      }
    }
    return items;
  }

  /** Busca na Fonte: enfileira os cards elegíveis que ainda não viraram Tarefa e confere as respostas esperadas. */
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

  /** Ativa a próxima Tarefa se nenhuma estiver ativa. Abre o portão de uma Tarefa que estava pausada. */
  async function schedule(): Promise<void> {
    const state = await readState();
    if (state.daemonPaused || state.tasks.some((t) => t.status === "ativa")) return;
    const now = clock.now();
    const next = state.tasks.find((t) => t.status === "enfileirada" && !t.pauseRequested && (t.notBefore ?? 0) <= now);
    if (!next) {
      const wakeAt = Math.min(
        ...state.tasks.filter((t) => t.status === "enfileirada" && t.notBefore).map((t) => t.notBefore as number),
      );
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
      if (task?.status !== "enfileirada" || draft.tasks.some((t) => t.status === "ativa")) return;
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
  async function emitStatusChanges(): Promise<void> {
    const state = await readState();
    const changed = state.tasks.filter((t) => known.get(t.id) !== t.status);
    known = new Map(state.tasks.map((t) => [t.id, t.status]));
    for (const t of changed) {
      await events.append({
        type: "task",
        project: t.project,
        id: t.id,
        key: t.key,
        status: t.status,
        ...(t.reason && (t.status === "bloqueada" || t.status === "enfileirada" || t.status === "vetada")
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

  const TERMINAL = new Set(["concluida", "cancelada", "bloqueada", "vetada"]);
  const commands: FactoryCommands = {
    pause: (id: string) =>
      updateTask(id, (task) => {
        if (TERMINAL.has(task.status)) return;
        task.pauseRequested = true;
        if (task.status === "enfileirada") task.status = "pausada";
      }),
    resume: (id: string) =>
      updateTask(id, (task) => {
        task.pauseRequested = false;
        if (task.status === "pausada") task.status = "enfileirada";
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
      now: clock.now,
      armTimer,
    }));

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
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
