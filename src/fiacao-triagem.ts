import { readFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import type { Models } from "@earendil-works/pi-ai";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import type { Card } from "./demand-source.js";
import type { StepRuntime } from "./durable.js";
import { StateDoc } from "./durable.js";
import { tarefaDoEstado } from "./estado-fabrica.js";
import type { EventRecorder } from "./events.js";
import type { ProjetoDaTarefa } from "./fiacao-tarefa.js";
import { numeroDaChave } from "./packages/fonte-demanda/index.js";
import { avaliarIssue, type EstadoTriagem, triagemDaTarefa } from "./packages/triagem/index.js";
import { findClosingCommit, recentSubjects } from "./prior-work.js";
import { resolveRepository } from "./repo-resolver.js";
import type { TriageResult } from "./triage.js";
import { requestTriage, triageInput } from "./triage-modelo.js";

/** Dados da execução de triagem: a Tarefa, o runtime, o projeto e o modelo, sem a fábrica inteira. */
export interface ContextoTriagem {
  input: { id: string; project: string; key: string };
  runtime: StepRuntime;
  harness: Harness;
  eventos: EventRecorder;
  projeto: ProjetoDaTarefa;
  projectOf: (name: string) => ProjetoDaTarefa;
  models: Models;
  cartao: () => Promise<Card>;
}

export async function readKnowledge(dir: string | undefined): Promise<string | undefined> {
  if (!dir) return undefined;
  try {
    return await readFile(join(dir, "knowledge.md"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** Triagem da issue: `triage` decide e aplica; `evaluate` coleta os sinais e pergunta ao modelo. */
export function criarTriagemDaTarefa(ctx: ContextoTriagem) {
  const { input, runtime, harness, eventos, projeto, projectOf, models, cartao } = ctx;
  const project = projeto;
  const { source } = projeto;

  /** Triagem da issue (ADR-0014): a decisão está no pacote triagem; os sinais e o modelo ficam em `evaluate`. */
  async function triage(): Promise<"aguardar" | "recusada" | "adiar" | undefined> {
    return triagemDaTarefa(
      {
        alterar: async <T>(fn: (estado: EstadoTriagem) => T): Promise<T> => {
          let resultado!: T;
          await runtime.commit(async (tx) => {
            resultado = fn((await tx.doc(StateDoc)) as unknown as EstadoTriagem);
          });
          return resultado;
        },
        configuracao: (nome) => {
          const { source } = projectOf(nome).config;
          return source.type === "github"
            ? { triageApproval: source.triageApproval, maxActive: source.maxActive }
            : undefined;
        },
        avaliar: (conversa) => evaluate(conversa),
        fecharRecusada: async (nome, chave, comentario, motivo) => {
          const { writer } = projectOf(nome);
          await writer.commentOnce(chave, comentario);
          await writer.dismiss(chave, motivo);
        },
        avisarDuvida: async (nome, chave, mensagem) => {
          await eventos.append({ type: "notify", project: nome, target: chave, reason: "triagem", message: mensagem });
        },
      },
      { id: input.id, project: input.project, key: input.key },
    );
  }

  /** Decide a triagem da issue. A regra (regras, classificador ou modelo) está no pacote triagem; a coleta e o modelo ficam aqui. */
  async function evaluate(conversation: ConversationId | null): Promise<TriageResult> {
    return avaliarIssue(
      {
        coletar: async () => {
          const card = await cartao();
          const others = (await source.listAssignedCards(project.config.source.assignee)).filter(
            (c) => c.key !== card.key,
          );
          const mapping = resolveRepository(project.config.repositories, card);
          const repoPath = mapping && resolvePath(mapping.path);
          const n = numeroDaChave(input.key);
          const comments = await source.listComments(input.key);
          const sinais = {
            card,
            others,
            comments,
            pullRequests: (await source.linkedPullRequests?.(input.key)) ?? [],
            mergedCommit: repoPath ? await findClosingCommit(repoPath, input.key, n) : null,
          };
          return { sinais, caminhoRepo: repoPath || undefined };
        },
        assuntosRecentes: (caminho) => recentSubjects(caminho),
        conhecimento: () => readKnowledge(project.knowledgeDir),
        papelDeTriagem: () => project.config.roles.triage ?? project.config.roles.spec,
        classificador: (papel) => {
          const classifier = models
            .getModelsOfType("classifier", papel.provider)
            .find((m) => m.id === papel.model && m.provider === papel.provider);
          return classifier ? (contexto) => models.classify(classifier, contexto) : undefined;
        },
        modeloDeTriagem: (conversa, papel, contexto) =>
          requestTriage({
            harness: harness,
            commit: runtime.commit,
            taskId: runtime.taskId,
            model: papel,
            card: contexto.card,
            others: contexto.others,
            context: runtime.context,
            conversationId: conversa,
            remember: async (tx, id) => {
              const task = tarefaDoEstado(await tx.doc(StateDoc), input.id);
              if (task) task.triageConversation = id;
            },
            input: triageInput({
              card: contexto.card,
              comments: contexto.comments,
              others: contexto.others,
              recentCommits: contexto.recentCommits,
              knowledge: contexto.knowledge,
            }),
          }),
      },
      conversation,
    );
  }

  return { triage, evaluate };
}
