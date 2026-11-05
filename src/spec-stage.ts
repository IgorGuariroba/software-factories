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

/** Corta `text` para caber em `max` caracteres, já contando o marcador do que foi omitido. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = (omitted: number) => `\n[…truncado: ${omitted} caracteres omitidos]`;
  // O marcador depende de quanto foi omitido; reservar o tamanho do maior marcador possível mantém o corte em `max`.
  const keep = Math.max(0, max - marker(text.length).length);
  return `${text.slice(0, keep)}${marker(text.length - keep)}`.slice(0, max);
}

/**
 * Tudo o que o modelo recebe sobre o card, sem passar de `SPEC_INPUT_MAX_CHARS` (títulos, separadores e marcadores
 * incluídos). Comentários da própria fábrica ficam de fora. Quando não cabe tudo, o orçamento vai por prioridade:
 * descrição do card (os requisitos), conhecimento do projeto, comentários e, por último, anexos; cada seção cortada
 * leva um marcador.
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
  const SEPARATOR = "\n\n";
  type Section = { heading: string; text: string };
  const sections: Section[] = [{ heading: "## Descrição", text: card.description?.trim() || "(sem descrição)" }];
  if (knowledge?.trim()) sections.push({ heading: "## Conhecimento do projeto", text: knowledge.trim() });
  sections.push({
    heading: "## Comentários",
    text: human.map((c) => `**${c.author}:**\n${c.body}`).join(SEPARATOR) || "(nenhum)",
  });
  if (attachments.length > 0)
    sections.push({
      heading: "## Anexos",
      text: attachments.map((a) => `### ${a.name}${SEPARATOR}\`\`\`\n${a.content}\n\`\`\``).join(SEPARATOR),
    });

  // O que não é conteúdo (cabeçalho, títulos, separadores) sai do orçamento antes de dividir o resto.
  const structure = header.length + sections.reduce((n, sec) => n + 2 * SEPARATOR.length + sec.heading.length, 0);
  let budget = Math.max(0, SPEC_INPUT_MAX_CHARS - structure);
  const kept = new Map<Section, string>();
  for (const section of sections) {
    const text = truncate(section.text, budget);
    budget -= text.length;
    kept.set(section, text);
  }

  // Ordem de leitura: descrição, comentários, anexos, conhecimento.
  const order = ["## Descrição", "## Comentários", "## Anexos", "## Conhecimento do projeto"];
  const rendered = [...sections]
    .sort((x, y) => order.indexOf(x.heading) - order.indexOf(y.heading))
    .map((sec) => `${sec.heading}${SEPARATOR}${kept.get(sec)}`);
  return [header, ...rendered].join(SEPARATOR);
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
