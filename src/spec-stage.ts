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
import { isAutomationText } from "./effect-writer.js";

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

const ASK_TOOL = "perguntar_po";

/**
 * A saída de pergunta do grill. Como a entrega, ela não escreve nada: encerra a rodada, e a fábrica leva a pergunta ao
 * PO pelo Canal. A resposta volta nesta mesma conversa quando o PO responder.
 */
const askTool = defineTool({
  name: ASK_TOOL,
  description:
    "Leva ao PO uma dúvida de negócio (regra ou intenção da demanda) que o card, os comentários e os anexos não " +
    "respondem. A tarefa espera a resposta antes de seguir. Não use para dúvidas técnicas nem para o que já está no card.",
  parameters: obj({
    pergunta: str({ description: "A pergunta ao PO, objetiva e autocontida, em português do Brasil." }),
  }),
  execute: async () => ({ output: [{ type: "text", text: "Pergunta enviada ao PO." }], control: { terminate: true } }),
});

export const SpecExtension = defineExtension({ name: "fabrica.spec", tools: [deliverTool, askTool] });

const INSTRUCTIONS = `Você é o papel grill/SPEC de uma fábrica de software autônoma.
Leia o card, os comentários, os anexos, as perguntas já respondidas pelo PO e o conhecimento do projeto, e escreva:
- a SPEC: o que será entregue e o critério de aceite de cada item;
- os Tickets: as fatias de implementação da SPEC, em ordem, cada uma com seu critério de aceite.
Não invente requisitos que o card não sustenta. Escreva em português do Brasil.
Se faltar uma regra de negócio que só o PO pode decidir, chame ${ASK_TOOL} com uma única pergunta e pare.
Quando tiver o que precisa, entregue chamando a ferramenta ${DELIVER_TOOL} uma única vez; não responda em texto.`;

/**
 * Card raso: a descrição, os comentários humanos e os anexos de texto somam menos que isto em caracteres não brancos.
 * Antes da primeira SPEC de um card raso, a fábrica pergunta ao PO em vez de especificar sobre suposições.
 */
export const SHALLOW_CARD_MIN_CHARS = 80;

/** Se o card não tem conteúdo humano bastante para especificar (ver `SHALLOW_CARD_MIN_CHARS`). */
export function isShallowCard(card: Card, comments: CardComment[], attachments: TextAttachment[]): boolean {
  const human = comments.filter((c) => !isAutomationText(c.body)).map((c) => c.body);
  const text = [card.description ?? "", ...human, ...attachments.map((a) => a.content)].join("");
  return text.replace(/\s/g, "").length < SHALLOW_CARD_MIN_CHARS;
}

/** A pergunta que a fábrica faz ao PO diante de um card raso, antes de chamar o grill. */
export const SHALLOW_CARD_QUESTION =
  "Este card ainda não tem detalhe suficiente para eu especificar sem suposições. Pode descrever o objetivo, as " +
  "regras de negócio e os critérios de aceite esperados?";

/** Uma pergunta ao PO e a resposta, para o contexto do grill. */
export type AnsweredQuestion = { text: string; answer: string };

/** A mensagem que leva ao grill a resposta da última pergunta, na conversa em que ele perguntou. */
export const answerFollowUp = (q: AnsweredQuestion) =>
  `Resposta do PO à sua pergunta "${q.text}":\n\n${q.answer}\n\nSiga com a SPEC (ou faça outra pergunta, se ainda faltar regra de negócio).`;

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
 * descrição do card (os requisitos), respostas do PO, conhecimento do projeto, comentários e, por último, anexos; cada
 * seção cortada
 * leva um marcador.
 */
export function specInput(input: {
  card: Card;
  comments: CardComment[];
  attachments: TextAttachment[];
  knowledge: string | undefined;
  /** Perguntas ao PO já respondidas nesta Tarefa. */
  answered?: AnsweredQuestion[];
}): string {
  const { card, comments, attachments, knowledge, answered = [] } = input;
  const human = comments.filter((c) => !isAutomationText(c.body));
  const header = `# Card ${card.key}: ${card.title}\n\nStatus: ${card.status}`;
  const SEPARATOR = "\n\n";
  type Section = { heading: string; text: string };
  const sections: Section[] = [{ heading: "## Descrição", text: card.description?.trim() || "(sem descrição)" }];
  if (answered.length > 0)
    sections.push({
      heading: "## Perguntas ao PO",
      text: answered
        .map((q, i) => `**Pergunta ${i + 1}:** ${q.text}${SEPARATOR}**Resposta do PO:**\n${q.answer}`)
        .join(SEPARATOR),
    });
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
  const order = ["## Descrição", "## Perguntas ao PO", "## Comentários", "## Anexos", "## Conhecimento do projeto"];
  const rendered = [...sections]
    .sort((x, y) => order.indexOf(x.heading) - order.indexOf(y.heading))
    .map((sec) => `${sec.heading}${SEPARATOR}${kept.get(sec)}`);
  return [header, ...rendered].join(SEPARATOR);
}

/** Corpo do comentário "Tickets": checklist que as próximas etapas marcam. */
export const renderTickets = (tickets: SpecDelivery["tickets"]) =>
  tickets.map((t, i) => `- [ ] **${i + 1}. ${t.titulo}**: ${t.aceite}`).join("\n");

/** O que o grill devolveu: a entrega, ou uma pergunta ao PO. */
export type GrillOutcome = { kind: "spec"; delivery: SpecDelivery } | { kind: "question"; text: string };

/**
 * Pede a SPEC ao modelo numa conversa que pertence à Tarefa. A conversa e cada pedido têm identidade fixa
 * (`requestId`), então repetir a chamada (ex.: depois de um reinício) reaproveita a resposta já gravada em vez de
 * chamar o modelo de novo. Numa conversa que já tem pedidos, envia `followUp` (ex.: a resposta do PO) em vez de `input`.
 */
export async function requestSpec(opts: {
  harness: Harness;
  /** Commit da Tarefa durável. */
  commit: (change: (tx: Tx) => Promise<void>) => Promise<void>;
  taskId: TaskId;
  model: ModelRef;
  input: string;
  followUp?: string;
  requestId: string;
  context: Context;
}): Promise<GrillOutcome> {
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
      tools: [deliverTool, askTool],
      instructions: INSTRUCTIONS,
      maxTurns: 2,
    });
    conversationId = created.id;
  });
  const conversation = conversationId && (await harness.conversation(conversationId, context));
  if (!conversation) throw new Error("conversa da etapa SPEC não encontrada");

  const page = await conversation.entries({ order: "descending" }, 20, undefined, context);
  const previous = page.items.some((entry) => (entry as { model?: { role?: string }[] }).model?.[0]?.role === "user");
  const content = previous && opts.followUp ? opts.followUp : opts.input;
  const submission = await conversation.submit({ type: "input", content, requestId: opts.requestId }, context);
  const settled = await submission.wait(context);
  if (settled.status !== "done") throw new Error(`o modelo não respondeu à etapa SPEC (${settled.status})`);

  // Só vale o que o modelo respondeu a este pedido: as mensagens depois da última entrada do usuário.
  const latest = await conversation.entries({ order: "descending" }, 20, undefined, context);
  for (const entry of latest.items) {
    const message = (entry as { model?: { role?: string; content?: unknown }[] }).model?.[0];
    if (message?.role === "user") break;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    const call = message.content.find(
      (block): block is { type: "toolCall"; name: string; arguments: unknown } =>
        block?.type === "toolCall" && (block.name === DELIVER_TOOL || block.name === ASK_TOOL),
    );
    if (!call) continue;
    if (call.name === ASK_TOOL) {
      const pergunta = (call.arguments as { pergunta?: unknown } | undefined)?.pergunta;
      if (typeof pergunta === "string" && pergunta.trim()) return { kind: "question", text: pergunta.trim() };
      throw new Error(`pergunta inválida da etapa SPEC: ${ASK_TOOL} sem o texto da pergunta`);
    }
    const parsed = Delivery.safeParse(call.arguments);
    if (parsed.success) return { kind: "spec", delivery: parsed.data };
    throw new Error(`entrega inválida da etapa SPEC: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  throw new Error(`o modelo não entregou a SPEC pela ferramenta ${DELIVER_TOOL}`);
}
