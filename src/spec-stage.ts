import type { Context } from "@earendil-works/chord/context";
import {
  type ConversationId,
  configure,
  defineExtension,
  defineTool,
  type Harness,
  type TaskId,
  type Tx,
} from "@earendil-works/pi-durable";
import { arr, obj, str } from "@earendil-works/pi-schema";
import { z } from "zod";
import type { ModelRef } from "./config.js";
import type { Card, CardComment, TextAttachment } from "./demand-source.js";
import { AUTOMATION_PREFIX } from "./effect-writer.js";

/** O que o modelo entrega na etapa: a SPEC e as fatias de implementação. */
const Delivery = z.object({
  spec: z.string().min(1),
  tickets: z.array(z.object({ titulo: z.string().min(1), aceite: z.string().min(1) })).min(1),
});
export type SpecDelivery = z.infer<typeof Delivery>;

const DELIVER_TOOL = "entregar_spec";

/**
 * A única ferramenta do modelo nesta etapa. Ela não escreve em lugar nenhum: só encerra a rodada.
 * Quem publica os comentários é a fábrica, pelo escritor de efeitos.
 */
const deliverTool = defineTool({
  name: DELIVER_TOOL,
  description: "Entrega a SPEC e os Tickets do card. Chame uma única vez, com o conteúdo final.",
  parameters: obj({
    spec: str({ description: "SPEC em Markdown: o que será entregue e o critério de aceite de cada item." }),
    tickets: arr(
      obj({
        titulo: str({ description: "Fatia de implementação, pequena e verificável." }),
        aceite: str({ description: "Critério de aceite da fatia." }),
      }),
      { description: "Fatias de implementação da SPEC, na ordem em que devem ser feitas." },
    ),
  }),
  execute: async () => ({ output: [{ type: "text", text: "Recebido." }], control: { terminate: true } }),
});

export const SpecExtension = defineExtension({ name: "fabrica.spec", tools: [deliverTool] });

const INSTRUCTIONS = `Você é o papel grill/SPEC de uma fábrica de software autônoma.
Leia o card, os comentários, os anexos e o conhecimento do projeto, e escreva:
- a SPEC: o que será entregue e o critério de aceite de cada item;
- os Tickets: as fatias de implementação da SPEC, em ordem, cada uma com seu critério de aceite.
Não invente requisitos que o card não sustenta. Escreva em português do Brasil.
Entregue chamando a ferramenta ${DELIVER_TOOL} uma única vez; não responda em texto.`;

/**
 * Limite do texto enviado ao modelo, em caracteres (~30 mil tokens): cabe na janela dos modelos de SPEC com folga
 * para as instruções e a resposta. Um anexo ou uma discussão enorme não pode travar a Tarefa num erro de contexto.
 */
export const SPEC_INPUT_MAX_CHARS = 120_000;

/** Corta `text` em `max` caracteres, deixando um marcador do que foi omitido. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max))}\n[…truncado: ${text.length - Math.max(0, max)} caracteres omitidos]`;
}

/**
 * Tudo o que o modelo recebe sobre o card, dentro de `SPEC_INPUT_MAX_CHARS`. Comentários da própria fábrica ficam de
 * fora. Quando não cabe tudo, o orçamento vai por prioridade: conhecimento do projeto, descrição, comentários e, por
 * último, anexos; cada seção cortada leva um marcador.
 */
export function specInput(input: {
  card: Card;
  comments: CardComment[];
  attachments: TextAttachment[];
  knowledge: string | undefined;
}): string {
  const { card, comments, attachments, knowledge } = input;
  const human = comments.filter((c) => !c.body.startsWith(AUTOMATION_PREFIX));
  const header = `# Card ${card.key}: ${card.title}\n\nStatus: ${card.status}`;
  let budget = SPEC_INPUT_MAX_CHARS - header.length;
  const take = (text: string) => {
    const kept = truncate(text, budget);
    budget = Math.max(0, budget - kept.length);
    return kept;
  };

  const knowledgeText = knowledge?.trim() ? take(knowledge.trim()) : undefined;
  const description = take(card.description?.trim() || "(sem descrição)");
  const commentsText = take(human.map((c) => `**${c.author}:**\n${c.body}`).join("\n\n") || "(nenhum)");
  const attachmentsText =
    attachments.length > 0
      ? take(attachments.map((a) => `### ${a.name}\n\n\`\`\`\n${a.content}\n\`\`\``).join("\n\n"))
      : undefined;

  const parts = [header, `## Descrição\n\n${description}`, `## Comentários\n\n${commentsText}`];
  if (attachmentsText !== undefined) parts.push(`## Anexos\n\n${attachmentsText}`);
  if (knowledgeText !== undefined) parts.push(`## Conhecimento do projeto\n\n${knowledgeText}`);
  return parts.join("\n\n");
}

/** Corpo do comentário "Tickets": checklist que as próximas etapas marcam. */
export const renderTickets = (tickets: SpecDelivery["tickets"]) =>
  tickets.map((t, i) => `- [ ] **${i + 1}. ${t.titulo}**: ${t.aceite}`).join("\n");

/**
 * Pede a SPEC ao modelo numa conversa que pertence à Tarefa. A conversa e o pedido têm identidade fixa, então
 * repetir a chamada (ex.: depois de um reinício) reaproveita a resposta já gravada em vez de chamar o modelo de novo.
 */
export async function requestSpec(opts: {
  harness: Harness;
  /** Commit da Tarefa durável. */
  commit: (change: (tx: Tx) => Promise<void>) => Promise<void>;
  taskId: TaskId;
  model: ModelRef;
  input: string;
  context: Context;
}): Promise<SpecDelivery> {
  const { harness, context } = opts;
  let conversationId: ConversationId | undefined;
  await opts.commit(async (tx) => {
    const existing = (await tx.scanConversations({ ownerTaskId: opts.taskId }, 1)).items[0];
    if (existing) {
      conversationId = existing.id;
      return;
    }
    const created = await tx.createConversation({ ownership: { kind: "task", taskId: opts.taskId } });
    await configure(tx, created.id, {
      model: { provider: opts.model.provider, modelId: opts.model.model },
      extensions: [SpecExtension],
      tools: [deliverTool],
      instructions: INSTRUCTIONS,
      maxTurns: 2,
    });
    conversationId = created.id;
  });
  const conversation = conversationId && (await harness.conversation(conversationId, context));
  if (!conversation) throw new Error("conversa da etapa SPEC não encontrada");

  const submission = await conversation.submit({ type: "input", content: opts.input, requestId: "spec" }, context);
  const settled = await submission.wait(context);
  if (settled.status !== "done") throw new Error(`o modelo não respondeu à etapa SPEC (${settled.status})`);

  const page = await conversation.entries({ order: "descending" }, 20, undefined, context);
  for (const entry of page.items) {
    const message = (entry as { model?: { role?: string; content?: unknown }[] }).model?.[0];
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    const call = message.content.find(
      (block): block is { type: "toolCall"; name: string; arguments: unknown } =>
        block?.type === "toolCall" && block.name === DELIVER_TOOL,
    );
    if (!call) continue;
    const parsed = Delivery.safeParse(call.arguments);
    if (parsed.success) return parsed.data;
    throw new Error(`entrega inválida da etapa SPEC: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  throw new Error(`o modelo não entregou a SPEC pela ferramenta ${DELIVER_TOOL}`);
}
