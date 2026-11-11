import { resolve } from "node:path";
import type { AgenteDaEtapa } from "./agente-etapa-config.js";
import { comPromptAdicional, ferramentasParaEtapa, textoAdicionalDoAgente } from "./agente-etapa-config.js";
import type { CodeHost } from "./code-host.js";
import type { ConventionsConfig, RepoMapping } from "./config.js";
import { formatBranchName, resolveConventions } from "./conventions.js";
import type { Card } from "./demand-source.js";
import { copyOutOfCommit, type ImplementationProgress, StateDoc, type StepRuntime } from "./durable.js";
import { tarefaDoEstado } from "./estado-fabrica.js";
import type { EventRecorder } from "./events.js";
import type { ImplementationExtension } from "./implement-ferramentas.js";
import { criarConversaDaTarefa } from "./packages/modelo-etapa/index.js";
import { resolveRepository } from "./repo-resolver.js";
import { checkoutFactoryBranch, cloneForFactory, isValidBranchName, worktreePathFor } from "./workspace.js";

// Início da implementação de uma Tarefa: escolhe o repositório, clona, cria a branch na convenção e registra o progresso
// com a conversa do implementador, tudo numa só transação.

/** O que o início da implementação precisa da etapa. */
export interface ContextoInicio {
  taskId: string;
  repositoryPath?: string;
  repositories: RepoMapping[] | undefined;
  projectName: string;
  conventions: ConventionsConfig | undefined;
  card: Card;
  worktreesRoot: string;
  events: EventRecorder;
  codeHost: CodeHost;
  runtime: StepRuntime;
  agente: AgenteDaEtapa;
  tools: ImplementationExtension;
  instructions: string;
  maxTurns: number;
  /** Bloqueio de início (repositório sem mapeamento, nome de branch inválido), como o da etapa. */
  bloqueio: (mensagem: string) => Error;
}

export async function iniciarImplementacao(ctx: ContextoInicio): Promise<ImplementationProgress> {
  const {
    taskId,
    repositoryPath,
    repositories,
    projectName,
    conventions: convencoes,
    card,
    worktreesRoot,
    events,
    codeHost,
    runtime,
    agente,
    tools,
    instructions,
    maxTurns,
    bloqueio,
  } = ctx;
  const mapping =
    repositoryPath !== undefined
      ? repositories?.find((candidate) => candidate.path === repositoryPath)
      : resolveRepository(repositories, card);
  if (!mapping) {
    const reason = `nenhum repositório mapeado para o card ${card.key} ("${card.title}")`;
    await events.append({
      type: "blocked",
      project: projectName,
      target: card.key,
      action: "resolver-repositorio",
      content: card.title,
      reason,
    });
    throw bloqueio(reason);
  }
  const repoPath = resolve(mapping.path);
  const worktree = worktreePathFor(worktreesRoot, projectName, card.key);
  const { defaultBranch } = await cloneForFactory(repoPath, worktree);
  const conventions = resolveConventions(await codeHost.discoverConventions(worktree), convencoes);
  const branch = formatBranchName(conventions, card);
  if (!(await isValidBranchName(worktree, branch)))
    throw bloqueio(`a convenção de branch gerou um nome inválido: "${branch}"`);
  const { head, adopted } = await checkoutFactoryBranch(worktree, branch, defaultBranch);

  let created: ImplementationProgress | undefined;
  await runtime.commit(async (tx) => {
    const modelo = agente.modelo;
    if (!modelo) throw new Error("a implementação não tem modelo configurado");
    const conversationId = await criarConversaDaTarefa(tx, runtime.taskId, modelo, {
      extensions: [tools.extension],
      tools: ferramentasParaEtapa(tools.tools, agente.ferramentas, "implementacao"),
      instructions: comPromptAdicional(instructions, textoAdicionalDoAgente(agente)),
      maxTurns: maxTurns,
    });
    created = {
      repoPath,
      worktree,
      branch,
      branchOrigin: adopted ? "adotada" : "criada",
      commitPattern: conventions.commit,
      test: copyOutOfCommit(mapping.test),
      ...(mapping.format ? { format: copyOutOfCommit(mapping.format) } : {}),
      conversationId,
      head,
      baseHead: head,
      defaultBranch,
      commits: [],
      baseline: null,
      requests: 0,
      rejections: 0,
      feedback: null,
      pushed: false,
    };
    const task = tarefaDoEstado(await tx.doc(StateDoc), taskId);
    if (task) task.implementation = copyOutOfCommit(created);
  });
  if (!created) throw new Error("progresso da implementação não foi criado");
  return created;
}
