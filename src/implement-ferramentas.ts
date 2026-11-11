import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import { defineExtension, defineTool, type ToolExecutionApi } from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";
import { type ImplementationProgress, type QueuedTask, StateDoc } from "./durable.js";
import type { EventRecorder } from "./events.js";
import { describeRun } from "./implement-verificacao.js";
import { executarNoSandbox, sandboxDisponivel } from "./sandbox.js";
import type { TestRunner } from "./test-runner.js";
import { assertFactoryWorktree, confine, PathRefused } from "./workspace.js";

// Ferramentas do implementador (ler, escrever, testar, shell no sandbox). Elas acham a Tarefa pela conversa a cada
// chamada: continuam no clone certo depois de um reinício e recusam conversas que não são de uma Tarefa em implementação.

export interface ImplementationDeps {
  /** Raiz dos clones da fábrica, sob o diretório de estado. */
  worktreesRoot: string;
  testRunner: TestRunner;
  events: EventRecorder;
}

const MAX_READ_CHARS = 100_000;

const text = (value: string) => ({ output: [{ type: "text" as const, text: value }] });

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

  // Bash do modelo: roda só dentro do sandbox (ADR-0006). Sem o bwrap, a chamada é recusada, nunca executada direto.
  const shellTool = defineTool({
    name: "executar_comando",
    description:
      "Roda um comando de shell no clone da Tarefa, dentro de sandbox: sem rede, com o clone como único lugar gravável.",
    parameters: obj({ comando: str({ description: "Comando de shell, executado na raiz do repositório." }) }),
    execute: async (args, api, context) => {
      const { progress, worktree } = await workspaceOf(api, context);
      if (!sandboxDisponivel()) throw new Error("recusado: o sandbox bubblewrap não está disponível neste host");
      const run = await executarNoSandbox({
        cwd: worktree,
        comando: args.comando,
        timeoutMs: progress.test.timeoutSeconds * 1000,
        signal: context.abortSignal,
      });
      if (run.timedOut) return text(`tempo esgotado\n${run.output}`);
      return text(`código ${run.exitCode}\n${run.output}`);
    },
  });

  const tools = [readTool, writeTool, testTool, shellTool];
  return { extension: defineExtension({ name: "fabrica.implementacao", tools }), tools };
}

export type ImplementationExtension = ReturnType<typeof createImplementationExtension>;
