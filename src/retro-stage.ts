import { randomBytes } from "node:crypto";
import { configure, defineExtension, defineTool, type Harness } from "@earendil-works/pi-durable";
import { arr, obj, oneOf, str } from "@earendil-works/pi-schema";
import { z } from "zod";
import type { ModelRef, ProjectConfig } from "./config.js";
import {
  type RetroKind,
  type RetroProposal,
  type RetroRecord,
  type RetroStage,
  StateDoc,
  type StepRuntime,
} from "./durable.js";
import { type EffectWriter, GuardrailViolation } from "./effect-writer.js";
import type { EventRecorder } from "./events.js";
import type { RetroIssue, RetroSink } from "./retro-sink.js";

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
  execute: async () => ({ output: [{ type: "text", text: "Recebido." }], control: { terminate: true } }),
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

/** Semelhança mínima (Jaccard dos tokens do título) para uma issue aberta contar como "parecida". */
export const SIMILARITY_THRESHOLD = 0.6;

const STOPWORDS = new Set(
  "a o as os e ou de da do das dos em na no nas nos para pra por com sem um uma uns umas que ao aos se the of to in on and for"
    .split(" ")
    .filter(Boolean),
);

/** Tokens do título: minúsculas, sem acentos, sem pontuação, sem palavras vazias e sem tokens de uma letra. */
const tokens = (title: string) =>
  new Set(
    title
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
  );

/** Similaridade de Jaccard entre os tokens de dois títulos (0 a 1). */
export function titleSimilarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  const shared = [...x].filter((t) => y.has(t)).length;
  return shared / (x.size + y.size - shared);
}

/** A issue aberta mais parecida com `title`, acima do limiar; no empate, a mais antiga (menor número). */
export function findSimilarIssue(issues: RetroIssue[], title: string): RetroIssue | undefined {
  let best: { issue: RetroIssue; score: number } | undefined;
  for (const issue of [...issues].sort((a, b) => a.number - b.number)) {
    const score = titleSimilarity(issue.title, title);
    if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) best = { issue, score };
  }
  return best?.issue;
}

/** Um identificador opaco para a Tarefa: aleatório, sem derivar do projeto nem do card. */
export const newTaskRef = () => randomBytes(6).toString("hex");

const STAGE_LABEL: Record<RetroStage, string> = { spec: "SPEC", implementacao: "implementação", tarefa: "consolidada" };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * A retrô de uma etapa (ou a consolidada). Pede a retrô ao modelo numa conversa da Tarefa, grava a entrega no estado e
 * só então publica cada proposta, registrando cada uma: uma nova tentativa não chama o modelo de novo nem duplica
 * issue, "+1" ou aviso. Uma falha conta uma tentativa e é relançada (a Tarefa tenta de novo); na
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
  model: ModelRef;
  /** O relato da etapa para o modelo; só montado se o modelo ainda não entregou. */
  input: () => Promise<string>;
  sink?: RetroSink;
  /** Repositório (público) da fábrica; sem ele, as propostas da fábrica só ficam registradas. */
  repo?: string;
  /** Link local da Tarefa a partir do id opaco. */
  linkFor: (ref: string) => string;
}): Promise<void> {
  const { runtime, stage, config, events } = opts;
  const { context } = runtime;

  let record: RetroRecord | undefined;
  let ref = "";
  await runtime.commit(async (tx) => {
    const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === opts.taskId);
    if (!task) return;
    task.ref ??= newTaskRef();
    ref = task.ref;
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
    record = clone(stored);
  });
  if (record?.status !== "em-andamento") return;
  const retro: RetroRecord = record;
  const save = () =>
    runtime.commit(async (tx) => {
      runtime.signal.throwIfAborted();
      const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === opts.taskId);
      if (task) task.retros = (task.retros ?? []).map((r) => (r.stage === stage ? clone(retro) : r));
    });

  try {
    if (!retro.proposals) {
      const delivery = await request();
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
      await publish(proposal);
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

  async function request(): Promise<z.infer<typeof Delivery>> {
    if (!retro.conversationId) {
      await runtime.commit(async (tx) => {
        const conversation = await tx.createConversation({ ownership: { kind: "task", taskId: runtime.taskId } });
        await configure(tx, conversation.id, {
          model: { provider: opts.model.provider, modelId: opts.model.model },
          extensions: [RetroExtension],
          tools: [deliverTool],
          instructions: INSTRUCTIONS,
          maxTurns: 2,
        });
        retro.conversationId = conversation.id;
        const task = (await tx.doc(StateDoc)).tasks.find((t) => t.id === opts.taskId);
        if (task) task.retros = (task.retros ?? []).map((r) => (r.stage === stage ? clone(retro) : r));
      });
    }
    const conversation = retro.conversationId && (await opts.harness.conversation(retro.conversationId, context));
    if (!conversation) throw new Error(`conversa da retrô ${STAGE_LABEL[stage]} não encontrada`);
    // Um pedido por tentativa: repetir o id de um pedido que falhou devolveria a mesma submissão sem resposta.
    const requestId = `retro-${stage}-${retro.attempts}`;
    const submission = await conversation.submit({ type: "input", content: await opts.input(), requestId }, context);
    const settled = await submission.wait(context);
    if (settled.status !== "done") throw new Error(`o modelo não respondeu à retrô (${settled.status})`);

    const latest = await conversation.entries({ order: "descending" }, 20, undefined, context);
    for (const entry of latest.items) {
      const message = (entry as { model?: { role?: string; content?: unknown }[] }).model?.[0];
      if (message?.role === "user") break;
      if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
      const call = message.content.find(
        (block): block is { type: "toolCall"; name: string; arguments: unknown } =>
          block?.type === "toolCall" && block.name === DELIVER_TOOL,
      );
      if (!call) continue;
      const parsed = Delivery.safeParse(call.arguments);
      if (parsed.success) return parsed.data;
      throw new Error(`entrega inválida da retrô: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    }
    throw new Error(`o modelo não entregou a retrô pela ferramenta ${DELIVER_TOOL}`);
  }

  async function publish(proposal: RetroProposal): Promise<void> {
    if (proposal.kind === "conhecimento") {
      // A aprovação (e a rejeição com motivo) é do usuário; aqui a proposta só fica pendente.
      proposal.status = "pendente";
      return;
    }
    if (proposal.kind === "repo-time") {
      // Nunca vira issue nem MR no repositório do time: só um aviso ao usuário.
      const message =
        `Sugestão da retrô (${STAGE_LABEL[stage]}) da Tarefa ${opts.cardKey} para o repositório do time: ` +
        `${proposal.title}. ${proposal.description}`;
      const sent = events.list().some((e) => e.type === "notify" && e.target === opts.cardKey && e.message === message);
      if (!sent)
        await events.append({
          type: "notify",
          project: config.name,
          target: opts.cardKey,
          reason: "sugestao-repo-time",
          message,
        });
      proposal.status = "avisada";
      return;
    }

    const { sink, repo } = opts;
    if (!sink || !repo) {
      proposal.status = "sem-repo";
      return;
    }
    const taskMarker = `tarefa \`${ref}\``;
    const origin = `Origem: ${taskMarker}, retrô ${stage}, proposta ${proposal.n}.`;
    const footer = `${origin}\nTarefa: ${opts.linkFor(ref)}`;
    const mentions = (issue: RetroIssue, marker: string) =>
      issue.body.includes(marker) || issue.comments.some((c) => c.includes(marker));

    const open = await sink.listOpen(repo);
    // Já publicada numa tentativa anterior (ex.: a fábrica caiu logo depois de escrever).
    const published = open.find((i) => mentions(i, origin));
    if (published) {
      proposal.status = published.body.includes(origin) ? "issue-criada" : "mais-um";
      proposal.issue = { number: published.number, url: published.url };
      return;
    }
    const similar = findSimilarIssue(open, proposal.title);
    try {
      // Uma Tarefa conta uma vez por issue: a consolidada que repete uma proposta da etapa não comenta de novo.
      if (similar && mentions(similar, taskMarker)) {
        proposal.status = "ja-registrada";
        proposal.issue = { number: similar.number, url: similar.url };
      } else if (similar) {
        await opts.writer.commentRetroIssue(opts.cardKey, repo, similar.number, `+1\n\n${footer}`);
        proposal.status = config.dryRun ? "dry-run" : "mais-um";
        proposal.issue = { number: similar.number, url: similar.url };
      } else {
        const created = await opts.writer.openRetroIssue(opts.cardKey, repo, {
          // O GitHub aceita títulos de até 256 caracteres.
          title: proposal.title.slice(0, 200),
          body: `${proposal.description}\n\n---\n${footer}`,
        });
        proposal.status = created ? "issue-criada" : "dry-run";
        proposal.issue = created ?? null;
      }
    } catch (err) {
      // Barrada pelo guardrail (o evento já saiu): a proposta fica registrada e a retrô segue com as outras.
      if (!(err instanceof GuardrailViolation)) throw err;
      proposal.status = "bloqueada";
      proposal.reason = err.message;
    }
  }
}
