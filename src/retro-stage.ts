import { randomBytes } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import { defineExtension, defineTool, type Harness } from "@earendil-works/pi-durable";
import { arr, obj, oneOf, str } from "@earendil-works/pi-schema";
import { z } from "zod";
import {
  type AgenteDaEtapa,
  comPromptAdicional,
  ferramentasParaEtapa,
  textoAdicionalDoAgente,
} from "./agente-etapa-config.js";
import type { ProjectConfig } from "./config.js";
import {
  copyOutOfCommit,
  type RetroKind,
  type RetroProposal,
  type RetroRecord,
  type RetroStage,
  StateDoc,
  type StepRuntime,
} from "./durable.js";
import type { EffectWriter } from "./effect-writer.js";
import { tarefaDoEstado } from "./estado-fabrica.js";
import type { EventRecorder } from "./events.js";
import { chamadaDoPedido, criarConversaDaTarefa, EXECUCAO_DE_ENTREGA } from "./packages/modelo-etapa/index.js";
import type { RetroSink } from "./retro-sink.js";

const KINDS = ["fabrica", "conhecimento", "repo-time"] as const satisfies readonly RetroKind[];

/** O que o modelo entrega na retrô: um resumo e as propostas classificadas. */
const Delivery = z.object({
  resumo: z.string().min(1),
  propostas: z
    .array(z.object({ tipo: z.enum(KINDS), titulo: z.string().min(1), descricao: z.string().min(1) }))
    .max(10),
});

const DELIVER_TOOL = "entregar_retro";

/** A única ferramenta da retrô: não escreve em lugar nenhum, só encerra a rodada. Quem publica é a fábrica. */
const deliverTool = defineTool({
  name: DELIVER_TOOL,
  description: "Entrega a retrô: um resumo e as propostas de melhoria classificadas. Chame uma única vez.",
  parameters: obj({
    resumo: str({ description: "O que funcionou e o que não funcionou, em poucas linhas." }),
    propostas: arr(
      obj({
        tipo: oneOf(KINDS, {
          description:
            "fabrica: melhoria da própria fábrica; conhecimento: algo que a fábrica deve lembrar sobre o projeto; " +
            "repo-time: sugestão para o repositório do time.",
        }),
        titulo: str({ description: "Título curto e específico da melhoria." }),
        descricao: str({ description: "O problema observado e a melhoria proposta." }),
      }),
      { description: "Propostas de melhoria; vazia se não houver nada a melhorar.", maxItems: 10 },
    ),
  }),
  execute: EXECUCAO_DE_ENTREGA,
});

export const RetroExtension = defineExtension({ name: "fabrica.retro", tools: [deliverTool] });

/**
 * A regra de privacidade das propostas `fabrica`, que viram issues num repositório público. O código também saneia o
 * texto e barra a escrita se sobrar algum valor do projeto; a regra evita que o modelo escreva esses valores.
 */
export const RETRO_PUBLIC_RULE =
  "As propostas do tipo fabrica viram issues num repositório PÚBLICO: descreva só o comportamento da fábrica (etapas, " +
  "prompts, ferramentas, guardrails, limites), em termos genéricos. Nunca cite o card, a chave ou o título dele, o " +
  "projeto, pessoas, repositórios, caminhos, URLs, trechos de código nem o conteúdo da demanda.";

const INSTRUCTIONS = `Você é o papel de retrô de uma fábrica de software autônoma.
Leia o relato da etapa (ou da tarefa inteira) e avalie o desempenho da fábrica: o que funcionou, o que travou, o que
custou loops, perguntas ou falhas. Proponha melhorias concretas e classifique cada uma:
- fabrica: melhoria da própria fábrica de software;
- conhecimento: algo que a fábrica deveria lembrar sobre este projeto (padrões, armadilhas, critérios de review);
- repo-time: sugestão para o repositório do time (a fábrica só repassa ao usuário; nunca abre issue nem MR lá).
${RETRO_PUBLIC_RULE}
Não proponha nada sem evidência no relato; sem melhorias, entregue a lista vazia. Escreva em português do Brasil.
Entregue chamando a ferramenta ${DELIVER_TOOL} uma única vez; não responda em texto.`;

/** Falhas seguidas de uma retrô antes de ela desistir. Desistir não bloqueia a Tarefa: ela segue sem a retrô. */
export const MAX_RETRO_ATTEMPTS = 3;

/** Um identificador opaco para a Tarefa: aleatório, sem derivar do projeto nem do card. */
export const newTaskRef = () => randomBytes(6).toString("hex");

const STAGE_LABEL: Record<RetroStage, string> = {
  triagem: "triagem",
  spec: "SPEC",
  implementacao: "implementação",
  review: "review",
  mr: "PR/MR",
  tarefa: "consolidada",
};

/**
 * A retrô de uma etapa (ou a consolidada). Pede a retrô ao modelo numa conversa da Tarefa e grava a entrega no estado.
 * Propostas públicas ficam pendentes para revisão humana; avisos ao time são registrados. Uma falha conta uma tentativa
 * e é relançada (a Tarefa tenta de novo); na
 * `MAX_RETRO_ATTEMPTS`ª, a retrô fica `falhou` e a Tarefa segue sem ela.
 */
export async function runRetro(opts: {
  harness: Harness;
  runtime: StepRuntime;
  /** Id da Tarefa na fila (`<projeto>/<card>`). */
  taskId: string;
  cardKey: string;
  stage: RetroStage;
  config: ProjectConfig;
  writer: EffectWriter;
  events: EventRecorder;
  /** Configuração efetiva da retrô (Agente da etapa): modelo, ferramentas e prompt adicional. */
  agente: AgenteDaEtapa;
  /** O relato da etapa para o modelo; só montado se o modelo ainda não entregou. */
  input: () => Promise<string>;
  sink?: RetroSink;
  /** Repositório público da fábrica; a publicação é feita separadamente após revisão. */
  repo?: string;
}): Promise<void> {
  const { runtime, stage, config, events } = opts;
  const { context } = runtime;

  let record: RetroRecord | undefined;
  await runtime.commit(async (tx) => {
    const task = tarefaDoEstado(await tx.doc(StateDoc), opts.taskId);
    if (!task) return;
    task.ref ??= newTaskRef();
    let stored = task.retros?.find((r) => r.stage === stage);
    if (!stored) {
      stored = {
        stage,
        status: "em-andamento",
        attempts: 0,
        error: null,
        conversationId: null,
        summary: null,
        proposals: null,
      };
      task.retros = [...(task.retros ?? []), stored];
    }
    record = copyOutOfCommit(stored);
  });
  if (record?.status !== "em-andamento") return;
  const retro: RetroRecord = record;
  const save = () =>
    runtime.commit(async (tx) => {
      runtime.signal.throwIfAborted();
      const task = tarefaDoEstado(await tx.doc(StateDoc), opts.taskId);
      if (task) task.retros = (task.retros ?? []).map((r) => (r.stage === stage ? copyOutOfCommit(retro) : r));
    });

  const contexto = (): ContextoRetro => ({
    retro,
    runtime,
    taskId: opts.taskId,
    stage,
    cardKey: opts.cardKey,
    projectName: config.name,
    events,
    agente: opts.agente,
    harness: opts.harness,
    input: opts.input,
    context,
  });

  try {
    if (!retro.proposals) {
      const delivery = await pedirRetro(contexto());
      retro.summary = delivery.resumo;
      retro.proposals = delivery.propostas.map((p, i) => ({
        n: i + 1,
        kind: p.tipo,
        title: p.titulo,
        description: p.descricao,
        status: "a-publicar",
        issue: null,
        reason: null,
      }));
      // A entrega fica gravada antes de publicar qualquer coisa.
      await save();
    }
    for (const proposal of retro.proposals) {
      if (proposal.status !== "a-publicar") continue;
      await publicarProposta(contexto(), proposal);
      await save();
    }
    retro.status = "concluida";
    retro.error = null;
    await save();
    await events.append({
      type: "retro",
      project: config.name,
      target: opts.cardKey,
      stage,
      status: "concluida",
      message: `Retrô ${STAGE_LABEL[stage]}: ${retro.proposals.length} proposta(s).`,
    });
  } catch (err) {
    if (runtime.signal.aborted) throw err;
    const message = err instanceof Error ? err.message : String(err);
    retro.attempts++;
    retro.error = message;
    if (retro.attempts < MAX_RETRO_ATTEMPTS) {
      await save();
      throw err;
    }
    retro.status = "falhou";
    await save();
    await events.append({
      type: "retro",
      project: config.name,
      target: opts.cardKey,
      stage,
      status: "falhou",
      message: `Retrô ${STAGE_LABEL[stage]} desistiu depois de ${retro.attempts} tentativas; a Tarefa segue sem ela: ${message}`,
    });
  }
}

/** O que pedir a retrô ao modelo e publicar as propostas precisam da etapa e da Tarefa, sem a execução inteira. */
export interface ContextoRetro {
  retro: RetroRecord;
  runtime: StepRuntime;
  taskId: string;
  stage: RetroStage;
  cardKey: string;
  projectName: string;
  events: EventRecorder;
  agente: AgenteDaEtapa;
  harness: Harness;
  input: () => Promise<string>;
  context: Context;
}

export async function pedirRetro(ctx: ContextoRetro): Promise<z.infer<typeof Delivery>> {
  const { retro, runtime, taskId, stage, agente, harness, input, context } = ctx;
  if (!retro.conversationId) {
    await runtime.commit(async (tx) => {
      const modelo = agente.modelo;
      if (!modelo) throw new Error("a retrô não tem modelo configurado");
      retro.conversationId = await criarConversaDaTarefa(tx, runtime.taskId, modelo, {
        extensions: [RetroExtension],
        tools: ferramentasParaEtapa([deliverTool], agente.ferramentas, "retro"),
        instructions: comPromptAdicional(INSTRUCTIONS, textoAdicionalDoAgente(agente)),
        maxTurns: 2,
      });
      const task = tarefaDoEstado(await tx.doc(StateDoc), taskId);
      if (task) task.retros = (task.retros ?? []).map((r) => (r.stage === stage ? copyOutOfCommit(retro) : r));
    });
  }
  const conversation = retro.conversationId && (await harness.conversation(retro.conversationId, context));
  if (!conversation) throw new Error(`conversa da retrô ${STAGE_LABEL[stage]} não encontrada`);
  // Um pedido por tentativa: repetir o id de um pedido que falhou devolveria a mesma submissão sem resposta.
  const requestId = `retro-${stage}-${retro.attempts}`;
  const submission = await conversation.submit({ type: "input", content: await input(), requestId }, context);
  const settled = await submission.wait(context);
  if (settled.status !== "done") throw new Error(`o modelo não respondeu à retrô (${settled.status})`);

  const call = await chamadaDoPedido(conversation, context, [DELIVER_TOOL]);
  if (!call) throw new Error(`o modelo não entregou a retrô pela ferramenta ${DELIVER_TOOL}`);
  const parsed = Delivery.safeParse(call.arguments);
  if (parsed.success) return parsed.data;
  throw new Error(`entrega inválida da retrô: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
}

export async function publicarProposta(ctx: ContextoRetro, proposal: RetroProposal): Promise<void> {
  const { stage, cardKey, projectName, events } = ctx;
  if (proposal.kind === "conhecimento") {
    // A aprovação (e a rejeição com motivo) é do usuário; aqui a proposta só fica pendente.
    proposal.status = "pendente";
    return;
  }
  if (proposal.kind === "repo-time") {
    // Nunca vira issue nem MR no repositório do time: só um aviso ao usuário.
    const message =
      `Sugestão da retrô (${STAGE_LABEL[stage]}) da Tarefa ${cardKey} para o repositório do time: ` +
      `${proposal.title}. ${proposal.description}`;
    const sent = events.list().some((e) => e.type === "notify" && e.target === cardKey && e.message === message);
    if (!sent)
      await events.append({
        type: "notify",
        project: projectName,
        target: cardKey,
        reason: "sugestao-repo-time",
        message,
      });
    proposal.status = "avisada";
    return;
  }

  // A publicação externa exige revisão humana explícita, fora da execução da Tarefa.
  proposal.status = "pendente";
}
