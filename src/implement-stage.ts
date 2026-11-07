import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import {
  configure,
  defineExtension,
  defineTool,
  type Harness,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";
import type { CodeHost } from "./code-host.js";
import type { ModelRef, ProjectConfig } from "./config.js";
import { formatBranchName, formatCommitMessage, resolveConventions } from "./conventions.js";
import type { Card } from "./demand-source.js";
import {
  copyOutOfCommit,
  type ImplementationProgress,
  type QueuedTask,
  StateDoc,
  type StepRuntime,
  type TddPhase,
} from "./durable.js";
import type { EffectWriter } from "./effect-writer.js";
import type { EventRecorder } from "./events.js";
import { git } from "./git.js";
import { resolveRepository } from "./repo-resolver.js";
import type { SpecDelivery } from "./spec-stage.js";
import type { TestRun, TestRunner } from "./test-runner.js";
import {
  assertFactoryWorktree,
  changedPaths,
  checkoutFactoryBranch,
  cloneForFactory,
  confine,
  isTestFile,
  isValidBranchName,
  PathRefused,
  worktreePathFor,
} from "./workspace.js";

/** A Tarefa não pode seguir sem uma decisão humana (ex.: repositório sem mapeamento, TDD recusado no limite). */
export class StageBlocked extends Error {
  override name = "StageBlocked";
}

/** Quantas vezes seguidas a fábrica recusa uma fase do TDD antes de bloquear a Tarefa. */
export const MAX_TDD_REJECTIONS = 3;

/** Rodadas de ferramenta de um pedido ao modelo. */
const MAX_TURNS = 30;

/** Maior arquivo que `ler_arquivo` devolve inteiro. */
const MAX_READ_CHARS = 100_000;

const INSTRUCTIONS = `Você é o papel implementador de uma fábrica de software autônoma e trabalha com TDD, ticket a ticket.
Você só tem as ferramentas ler_arquivo, escrever_arquivo e rodar_testes, sempre dentro do repositório.
Não há shell nem git: a fábrica verifica cada fase, roda os testes e faz os commits.
- Fase de teste: escreva só o teste do ticket. A fábrica exige que só arquivos de teste mudem e que os testes falhem.
- Fase de implementação: escreva o código que faz os testes passarem, sem mexer nos testes. A fábrica exige que
  nenhum arquivo de teste mude e que os testes passem.
Quando terminar a fase, responda em texto, sem chamar ferramentas.`;

export interface ImplementationDeps {
  /** Raiz dos clones da fábrica, sob o diretório de estado. */
  worktreesRoot: string;
  testRunner: TestRunner;
  events: EventRecorder;
}

const text = (value: string) => ({ output: [{ type: "text" as const, text: value }] });

const describeRun = (run: TestRun) =>
  run.spawnError
    ? `o comando de teste não executou: ${run.spawnError}`
    : `${run.timedOut ? "tempo esgotado" : `código de saída ${run.exitCode}`}\n${run.output}`;

/**
 * As ferramentas do implementador. Elas não guardam o clone em memória: a cada chamada, acham pela conversa a Tarefa
 * no estado durável e usam o clone registrado nela (dentro da raiz da fábrica). Assim continuam no lugar certo depois
 * de um reinício, e recusam qualquer conversa que não seja de uma Tarefa em implementação.
 */
export function createImplementationExtension(deps: ImplementationDeps) {
  async function workspaceOf(api: ToolExecutionApi, context: Context) {
    const state = await api.snapshot(StateDoc, context);
    const task = state?.tasks.find((t) => t.implementation?.conversationId === api.conversationId);
    if (!task?.implementation) throw new Error("recusado: esta conversa não pertence a uma Tarefa em implementação");
    const worktree = await assertFactoryWorktree(deps.worktreesRoot, task.implementation.worktree);
    return { task: task as QueuedTask, progress: task.implementation as ImplementationProgress, worktree };
  }

  /** Resolve o caminho pedido; uma recusa vira evento `blocked` (aviso ao usuário) e erro para o modelo. */
  async function pathFor(task: QueuedTask, worktree: string, tool: string, requested: string): Promise<string> {
    try {
      return await confine(worktree, requested);
    } catch (err) {
      if (!(err instanceof PathRefused)) throw err;
      await deps.events.append({
        type: "blocked",
        project: task.project,
        target: task.key,
        action: tool,
        content: requested,
        reason: err.message,
      });
      throw new Error(`recusado: ${err.message}`);
    }
  }

  const readTool = defineTool({
    name: "ler_arquivo",
    description: "Lê um arquivo de texto do repositório.",
    parameters: obj({ caminho: str({ description: "Caminho relativo à raiz do repositório." }) }),
    execute: async (args, api, context) => {
      const { task, worktree } = await workspaceOf(api, context);
      const path = await pathFor(task, worktree, "ler_arquivo", args.caminho);
      const content = await readFile(path, "utf8").catch((err: NodeJS.ErrnoException) => {
        throw new Error(err.code === "ENOENT" ? `${args.caminho} não existe` : `não foi possível ler: ${err.message}`);
      });
      return text(content.length > MAX_READ_CHARS ? `${content.slice(0, MAX_READ_CHARS)}\n[…truncado]` : content);
    },
  });

  const writeTool = defineTool({
    name: "escrever_arquivo",
    description: "Cria ou substitui um arquivo do repositório com o conteúdo completo.",
    parameters: obj({
      caminho: str({ description: "Caminho relativo à raiz do repositório." }),
      conteudo: str({ description: "Conteúdo completo do arquivo." }),
    }),
    execute: async (args, api, context) => {
      const { task, worktree } = await workspaceOf(api, context);
      const path = await pathFor(task, worktree, "escrever_arquivo", args.caminho);
      if ((await stat(path).catch(() => undefined))?.isDirectory()) throw new Error(`${args.caminho} é um diretório`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, args.conteudo, "utf8");
      return text(`${args.caminho} salvo.`);
    },
  });

  const testTool = defineTool({
    name: "rodar_testes",
    description: "Roda o comando de teste configurado no repositório e devolve o código de saída e o fim da saída.",
    parameters: obj({}),
    execute: async (_args, api, context) => {
      const { progress, worktree } = await workspaceOf(api, context);
      const run = await deps.testRunner.run({
        cwd: worktree,
        command: progress.test.command,
        timeoutMs: progress.test.timeoutSeconds * 1000,
        signal: context.abortSignal,
      });
      return text(describeRun(run));
    },
  });

  const tools = [readTool, writeTool, testTool];
  return { extension: defineExtension({ name: "fabrica.implementacao", tools }), tools };
}

type ImplementationExtension = ReturnType<typeof createImplementationExtension>;

/** Renderiza o checklist de Tickets marcando os tickets já implementados. */
export const renderTicketsProgress = (tickets: SpecDelivery["tickets"], done: ReadonlySet<number>): string =>
  tickets.map((t, i) => `- [${done.has(i) ? "x" : " "}] **${i + 1}. ${t.titulo}**: ${t.aceite}`).join("\n");

/** Os passos do TDD, na ordem: teste e implementação de cada ticket. */
const stepsOf = (delivery: SpecDelivery) =>
  delivery.tickets.flatMap((_, ticket) => (["teste", "implementacao"] as const).map((phase) => ({ ticket, phase })));

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
  model: ModelRef;
  deps: ImplementationDeps;
  tools: ImplementationExtension;
}): Promise<void> {
  const { harness, runtime, config, writer, card, delivery, deps } = opts;
  const { context } = runtime;
  // Projeto sem repositórios mapeados: a Tarefa termina nos Tickets.
  if (!config.repositories?.length) return;

  const readProgress = async () => {
    let progress: ImplementationProgress | undefined;
    await runtime.commit(async (tx) => {
      const stored = (await tx.doc(StateDoc)).tasks.find((t) => t.id === opts.taskId)?.implementation;
      progress = stored ? copyOutOfCommit(stored) : undefined;
    });
    return progress;
  };
  const save = (progress: ImplementationProgress) =>
    runtime.commit(async (tx) => {
      // Depois do fechamento do daemon, o passo cancelado não grava mais nada: a retomada é de outro processo.
      runtime.signal.throwIfAborted();
      const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === opts.taskId);
      if (task) task.implementation = copyOutOfCommit(progress);
    });

  const progress = (await readProgress()) ?? (await start());
  const { worktree } = progress;
  await assertFactoryWorktree(deps.worktreesRoot, worktree).catch(() => {
    throw new StageBlocked(`o clone da fábrica ${worktree} sumiu; os commits não enviados se perderam`);
  });
  const conventions = { commit: progress.commitPattern };

  await reconcile();
  const done = () => new Set(progress.commits.filter((c) => c.phase === "implementacao").map((c) => c.ticket));
  await writer.upsertComment(card.key, "Tickets", renderTicketsProgress(delivery.tickets, done()));

  await checkBaseline();

  const conversation = await harness.conversation(progress.conversationId, context);
  if (!conversation) throw new Error("conversa da etapa de implementação não encontrada");

  for (const step of stepsOf(delivery)) {
    if (progress.commits.some((c) => c.ticket === step.ticket && c.phase === step.phase)) continue;
    for (;;) {
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
      const verdict = await verify(step.phase);
      if (typeof verdict === "string") {
        progress.requests++;
        progress.rejections++;
        progress.feedback = verdict;
        await save(progress);
        if (progress.rejections >= MAX_TDD_REJECTIONS)
          throw new StageBlocked(
            `TDD recusado ${progress.rejections} vezes na fase ${step.phase} do ticket ${step.ticket + 1}: ${verdict}`,
          );
        continue;
      }
      const ticket = delivery.tickets[step.ticket];
      const sha = await commit(verdict, step.phase, ticket?.titulo ?? "");
      progress.commits.push({ ...step, sha });
      progress.head = sha;
      progress.requests++;
      progress.rejections = 0;
      progress.feedback = null;
      // O checklist sai antes do registro: se a fábrica cair aqui, a retomada reconhece o commit pelo HEAD.
      if (step.phase === "implementacao")
        await writer.upsertComment(card.key, "Tickets", renderTicketsProgress(delivery.tickets, done()));
      await save(progress);
      break;
    }
  }

  if (!progress.pushed) {
    runtime.signal.throwIfAborted();
    await writer.pushBranch(worktree, progress.branch);
    progress.pushed = true;
    await save(progress);
  }

  /** Primeira vez: resolve o repositório, clona, cria a branch e a conversa, e registra tudo num commit só. */
  async function start(): Promise<ImplementationProgress> {
    const mapping = opts.repositoryPath !== undefined
      ? config.repositories?.find((candidate) => candidate.path === opts.repositoryPath)
      : resolveRepository(config.repositories, card);
    if (!mapping) {
      const reason = `nenhum repositório mapeado para o card ${card.key} ("${card.title}")`;
      await deps.events.append({
        type: "blocked",
        project: config.name,
        target: card.key,
        action: "resolver-repositorio",
        content: card.title,
        reason,
      });
      throw new StageBlocked(reason);
    }
    const repoPath = resolve(mapping.path);
    const worktree = worktreePathFor(deps.worktreesRoot, config.name, card.key);
    const { defaultBranch } = await cloneForFactory(repoPath, worktree);
    const conventions = resolveConventions(await opts.codeHost.discoverConventions(worktree), config.conventions);
    const branch = formatBranchName(conventions, card);
    if (!(await isValidBranchName(worktree, branch)))
      throw new StageBlocked(`a convenção de branch gerou um nome inválido: "${branch}"`);
    const { head, adopted } = await checkoutFactoryBranch(worktree, branch, defaultBranch);

    let created: ImplementationProgress | undefined;
    await runtime.commit(async (tx) => {
      const conversation = await tx.createConversation({ ownership: { kind: "task", taskId: runtime.taskId } });
      await configure(tx, conversation.id, {
        model: { provider: opts.model.provider, modelId: opts.model.model },
        extensions: [opts.tools.extension],
        tools: opts.tools.tools,
        instructions: INSTRUCTIONS,
        maxTurns: MAX_TURNS,
      });
      created = {
        repoPath,
        worktree,
        branch,
        branchOrigin: adopted ? "adotada" : "criada",
        commitPattern: conventions.commit,
        test: copyOutOfCommit(mapping.test),
        conversationId: conversation.id,
        head,
        commits: [],
        baseline: null,
        requests: 0,
        rejections: 0,
        feedback: null,
        pushed: false,
      };
      const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === opts.taskId);
      if (task) task.implementation = copyOutOfCommit(created);
    });
    if (!created) throw new Error("progresso da implementação não foi criado");
    return created;
  }

  /**
   * Um HEAD à frente do registrado por exatamente um commit é o commit do próximo passo, feito antes de a fábrica cair:
   * ele é registrado em vez de refeito. Só a fábrica commita neste clone, então qualquer outra divergência bloqueia.
   */
  async function reconcile(): Promise<void> {
    const head = (await git(worktree, ["rev-parse", "HEAD"])).trim();
    if (head === progress.head) return;
    const parent = (await git(worktree, ["rev-parse", "HEAD^"]).catch(() => "")).trim();
    const next = stepsOf(delivery).find(
      (s) => !progress.commits.some((c) => c.ticket === s.ticket && c.phase === s.phase),
    );
    if (parent !== progress.head || !next)
      throw new StageBlocked(`o histórico do clone ${worktree} divergiu do registrado (HEAD ${head})`);
    progress.commits.push({ ...next, sha: head });
    progress.head = head;
    progress.requests++;
    progress.rejections = 0;
    progress.feedback = null;
    await save(progress);
  }

  /** Roda a suíte configurada no clone. Um comando que nem executa bloqueia a Tarefa. */
  async function runSuite(): Promise<TestRun> {
    const run = await deps.testRunner.run({
      cwd: worktree,
      command: progress.test.command,
      timeoutMs: progress.test.timeoutSeconds * 1000,
      signal: runtime.signal,
    });
    if (run.spawnError) throw new StageBlocked(`o comando de teste não executa: ${run.spawnError}`);
    return run;
  }

  /**
   * Linha de base: antes do primeiro teste novo, a suíte precisa passar no estado da branch. Se ela já falha, a falha
   * da fase de teste não provaria nada sobre o teste novo, e a Tarefa bloqueia para uma pessoa decidir.
   */
  async function checkBaseline(): Promise<void> {
    if (!progress.baseline) {
      // Progresso anterior à linha de base, já com commits: a fase de teste dele já foi aceita.
      if (progress.commits.length > 0) return;
      const run = await runSuite();
      progress.baseline = run.exitCode === 0 ? "verde" : "vermelha";
      await save(progress);
    }
    if (progress.baseline === "vermelha")
      throw new StageBlocked(
        `a suíte de testes já falha na branch ${progress.branch} antes do primeiro teste novo (linha de base ` +
          "vermelha); a fábrica não tem como verificar o TDD até a suíte voltar a passar",
      );
  }

  /** Confere a fase: devolve os caminhos a commitar, ou por que recusou. */
  async function verify(phase: TddPhase): Promise<string[] | string> {
    const paths = await changedPaths(worktree);
    if (paths.length === 0) return "nenhum arquivo mudou";
    // Cada fase só toca o seu lado: o teste não traz código, e o código não afrouxa nem apaga o teste que falhava.
    const outside = paths.filter((p) => isTestFile(p, progress.test.files) !== (phase === "teste"));
    if (outside.length > 0) {
      // O que a fase não pode tocar volta ao último commit: o modelo não tem como apagar um arquivo novo.
      await discard(outside);
      const rule =
        phase === "teste"
          ? `na fase de teste só arquivos de teste podem mudar (padrões: ${progress.test.files.join(", ")})`
          : "na fase de implementação os arquivos de teste não podem mudar nem ser apagados";
      return `${rule}; a fábrica descartou as mudanças em: ${outside.join(", ")}`;
    }
    const run = await runSuite();
    if (run.timedOut) return `os testes estouraram ${progress.test.timeoutSeconds}s\n${run.output}`;
    if (run.exitCode === null) return `os testes foram interrompidos por um sinal\n${run.output}`;
    if (phase === "teste" && run.exitCode === 0)
      return `os testes passaram; o teste novo precisa falhar antes da implementação\n${run.output}`;
    if (phase === "implementacao" && run.exitCode !== 0) return `os testes falharam\n${describeRun(run)}`;
    return paths;
  }

  /** Devolve os caminhos ao estado do último commit: os que existem nele são restaurados, os novos são apagados. */
  async function discard(paths: string[]): Promise<void> {
    const tracked = (
      await git(worktree, ["--literal-pathspecs", "ls-tree", "-z", "--name-only", "HEAD", "--", ...paths])
    )
      .split("\0")
      .filter(Boolean);
    if (tracked.length > 0) await git(worktree, ["--literal-pathspecs", "checkout", "HEAD", "--", ...tracked]);
    for (const path of paths.filter((p) => !tracked.includes(p))) await rm(join(worktree, path), { force: true });
  }

  /** Commita exatamente os caminhos verificados, na convenção do repositório. Nunca um commit vazio. */
  async function commit(paths: string[], phase: TddPhase, title: string): Promise<string> {
    runtime.signal.throwIfAborted();
    await git(worktree, ["--literal-pathspecs", "add", "-A", "--", ...paths]);
    const message = formatCommitMessage(conventions, {
      type: phase === "teste" ? "test" : "feat",
      summary: phase === "teste" ? `adiciona teste para ${title}` : title,
      key: card.key,
    });
    await git(worktree, ["commit", "--quiet", "-m", message]);
    return (await git(worktree, ["rev-parse", "HEAD"])).trim();
  }
}
