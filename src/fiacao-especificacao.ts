import type { Harness } from "@earendil-works/pi-durable";
import { resolverAgenteDaEtapa } from "./agente-etapa-config.js";
import type { Card } from "./demand-source.js";
import { validarDestinatarioDoProjeto } from "./destinatarios-projeto.js";
import { copyOutOfCommit, type Question, type QueuedTask, StateDoc, type StepRuntime } from "./durable.js";
import { prazoPerguntaTecnica } from "./encaminhamento-tecnico.js";
import { tarefaDoEstado } from "./estado-fabrica.js";
import type { EventRecorder, NewEvent } from "./events.js";
import type { FiacaoTarefa, ProjetoDaTarefa } from "./fiacao-tarefa.js";
import { readKnowledge } from "./fiacao-triagem.js";
import { StageBlocked } from "./implement-verificacao.js";
import { ferramentasMcpDaEtapa } from "./mcp-etapa.js";
import { levarPergunta, PerguntaBloqueada } from "./packages/perguntas/index.js";
import { avisoTeamsDe, pessoasDoPapel } from "./packages/profiles/index.js";
import { conduzirSpec, type PerguntaSpec, SpecBloqueada } from "./packages/spec-etapa/index.js";
import { conversasExcluidasDaSpec } from "./packages/tarefa/index.js";
import { requestSpec, type SpecDelivery } from "./spec-stage.js";
import type { TeamsNotifier } from "./teams-mcp.js";

// SPEC (grill → SPEC → Tickets) e perguntas ao PO ou ao responsável técnico: a regra está nos pacotes spec-etapa e
// perguntas; aqui ficam as portas com o estado, a Fonte, o modelo e o canal desta Tarefa.

/** O que a SPEC e as perguntas precisam da Tarefa e da fábrica (sem a fábrica inteira). */
export interface ContextoEspecificacao {
  input: { id: string; project: string; key: string };
  runtime: StepRuntime;
  harness: Harness;
  registry: FiacaoTarefa["registry"];
  perguntas: FiacaoTarefa["perguntas"];
  eventos: EventRecorder;
  projeto: ProjetoDaTarefa;
  projectOf: (name: string) => ProjetoDaTarefa;
  clock: { now(): number };
  teams?: TeamsNotifier;
  cartao: () => Promise<Card>;
  lerTarefa: () => Promise<QueuedTask | undefined>;
}

/** Grill → SPEC e as perguntas ao PO ou ao responsável técnico. */
export function criarEspecificacaoDaTarefa(ctx: ContextoEspecificacao) {
  const { input, runtime, harness, registry, perguntas, eventos, projeto, projectOf, clock, teams, cartao, lerTarefa } =
    ctx;
  const project = projeto;
  const { source } = projeto;

  /** Grill → SPEC: a regra (esperar, card raso, conversa, bloqueio do ensaio) está no pacote spec-etapa. A fábrica
   * fornece o estado, a Fonte, o modelo e o canal. */
  async function grill(): Promise<SpecDelivery | "aguardar"> {
    try {
      return await conduzirSpec({
        perguntas: async () => {
          let questions: Question[] = [];
          await runtime.commit(async (tx) => {
            const stored = tarefaDoEstado(await tx.doc(StateDoc), input.id)?.questions;
            questions = stored ? copyOutOfCommit(stored) : [];
          });
          return questions as unknown as PerguntaSpec[];
        },
        cartao: async () => {
          const card = await cartao();
          const comments = await source.listComments(input.key);
          const attachments = await source.listTextAttachments(input.key);
          return { card, comments, attachments };
        },
        conhecimento: () => readKnowledge(project.knowledgeDir),
        revisaoDaSpec: async () => (await lerTarefa())?.specRevision ?? 0,
        configuracao: () => ({
          questionApproval: project.config.questionApproval,
          specApproval: project.config.specApproval,
        }),
        perguntar: (anteriores, texto, origem) => ask(anteriores as unknown as Question[], texto, origem),
        pedirSpec: async (entrada) => {
          const outcome = await requestSpec({
            harness: harness,
            commit: runtime.commit,
            taskId: runtime.taskId,
            agente: resolverAgenteDaEtapa(project.config, "spec"),
            ferramentasExtras: await ferramentasMcpDaEtapa(
              project.config,
              resolverAgenteDaEtapa(project.config, "spec"),
            ),
            instalarExtensao: (extensao) => registry.install(extensao),
            registrarConversa: (conversa) =>
              runtime.commit(async (tx) => {
                const atual = tarefaDoEstado(await tx.doc(StateDoc), input.id);
                if (atual) atual.specConversationId = conversa;
              }),
            context: runtime.context,
            requestId: entrada.requestId,
            exclude: await triageConversations(),
            input: entrada.input,
            followUp: entrada.followUp,
          });
          return outcome.kind === "question"
            ? { kind: "question" as const, text: outcome.text, technical: outcome.technical ?? false }
            : { kind: "entrega" as const, delivery: outcome.delivery };
        },
        gravarEntrega: async (entrega) => {
          await runtime.commit(async (tx) => {
            const task = tarefaDoEstado(await tx.doc(StateDoc), input.id);
            if (task) task.delivery = entrega;
          });
        },
      });
    } catch (err) {
      if (err instanceof SpecBloqueada) throw new StageBlocked(err.message);
      throw err;
    }
  }

  /** Conversas que a SPEC não deve retomar: a da triagem e as que o usuário esqueceu. */
  async function triageConversations(): Promise<string[]> {
    return conversasExcluidasDaSpec(await lerTarefa());
  }

  /** Leva a pergunta ao PO (ou ao responsável técnico): a regra está no pacote perguntas; canal, estado e eventos aqui. */
  async function ask(
    previous: Question[],
    text: string,
    origin: Question["origin"],
    purpose?: Question["purpose"],
  ): Promise<void> {
    try {
      await levarPergunta(
        {
          configuracao: (nome) => {
            const p = projectOf(nome);
            return {
              dryRun: p.config.dryRun,
              questionApproval: p.config.questionApproval,
              baseUrl: p.config.source.baseUrl,
              calendario: p.config.calendar,
              teamsDisponivel: Boolean(teams),
            };
          },
          destinatario: (nome, tecnica) => {
            const { config } = projectOf(nome);
            const pessoa = tecnica
              ? config.people.find((p) => p.id === config.source.assignee)
              : pessoasDoPapel(config, "po")[0];
            return pessoa ? { id: pessoa.id, teamsUserId: avisoTeamsDe(pessoa) } : undefined;
          },
          validarDestinatarioTecnico: (nome) => {
            const { config } = projectOf(nome);
            validarDestinatarioDoProjeto(
              config.people.map((p) => p.id),
              config.source.assignee,
            );
          },
          perguntarNoCanal: (entrada) => project.channel.ask(entrada),
          prazoPerguntaTecnica,
          agora: () => clock.now(),
          gravar: async (tarefaId, pergunta) => {
            await runtime.commit(async (tx) => {
              const task = tarefaDoEstado(await tx.doc(StateDoc), tarefaId);
              if (task && !task.questions?.some((q) => q.n === pergunta.n))
                task.questions = [...(task.questions ?? []), pergunta];
            });
          },
          avisarTeams: (tarefaId, projeto, chave, n) => perguntas.avisarTeams(tarefaId, projeto, chave, n),
          registrarEnviada: async (evento) => {
            await eventos.append(evento as NewEvent);
          },
        },
        { id: input.id, projeto: input.project, chave: input.key },
        previous,
        text,
        origin,
        purpose,
      );
    } catch (err) {
      if (err instanceof PerguntaBloqueada) throw new StageBlocked(err.message);
      throw err;
    }
  }

  return { grill, ask };
}
