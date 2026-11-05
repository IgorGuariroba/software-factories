import {
  type AssistantMessage,
  type Context,
  createModels,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Models,
} from "@earendil-works/pi-ai";

/** O que o modelo recebeu numa chamada: qual modelo e todo o contexto, serializado para buscas por trecho. */
export interface ModelCall {
  model: string;
  context: string;
  /** Texto das mensagens do usuário: o que a fábrica montou sobre o card, sem instruções nem ferramentas. */
  input: string;
  /** Ferramentas oferecidas ao modelo nesta chamada. */
  tools: string[];
  /** Papel da última mensagem do contexto (`user` num pedido novo, `toolResult` depois de ferramentas). */
  lastRole: string | undefined;
  /** Resultados de ferramenta que o modelo já recebeu nesta conversa. */
  toolResults: { name: string; isError: boolean; text: string }[];
}

const userText = (context: Pick<Context, "messages">): string =>
  context.messages
    .filter((m) => m.role === "user")
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : m.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
    )
    .join("\n");

/** Ferramentas disponíveis ao fim do contexto: as que as mensagens de sistema acrescentaram e não tiraram. */
const offeredTools = (context: Context): string[] => {
  const tools = new Set<string>();
  for (const m of context.messages) {
    if (m.role !== "system") continue;
    for (const t of m.toolsAdded ?? []) tools.add(t.name);
    for (const t of m.toolsRemoved ?? []) tools.delete(t.name);
  }
  return [...tools];
};

export interface SpecDelivery {
  spec: string;
  tickets: { titulo: string; aceite: string }[];
}

/** Resposta do modelo que entrega a SPEC e os Tickets pela ferramenta da etapa. */
export const deliverSpec = (delivery: SpecDelivery): AssistantMessage =>
  fauxAssistantMessage([fauxToolCall("entregar_spec", { ...delivery })], { stopReason: "toolUse" });

/** Resposta do modelo que, no grill, leva uma pergunta de negócio ao PO pela ferramenta da etapa. */
export const askPo = (pergunta: string): AssistantMessage =>
  fauxAssistantMessage([fauxToolCall("perguntar_po", { pergunta })], { stopReason: "toolUse" });

export const DEFAULT_SPEC: SpecDelivery = {
  spec: "Entregar o que o card pede.",
  tickets: [{ titulo: "Fazer o que o card pede", aceite: "O card está atendido" }],
};

/** Provedor de modelos faux: responde por roteiro e registra cada chamada. */
export class FakeModel {
  static readonly PROVIDER = "faux";
  readonly faux = fauxProvider({ provider: FakeModel.PROVIDER, models: [{ id: "spec-a" }, { id: "spec-b" }] });
  readonly calls: ModelCall[] = [];
  /** Como responder a cada chamada. Padrão: entrega uma SPEC genérica. */
  respond: (call: ModelCall) => AssistantMessage | Promise<AssistantMessage> = () => deliverSpec(DEFAULT_SPEC);

  constructor() {
    const step: FauxResponseFactory = async (context, _options, _state, model) => {
      this.faux.appendResponses([step]);
      const call: ModelCall = {
        model: model.id,
        context: JSON.stringify(context),
        input: userText(context),
        tools: offeredTools(context),
        lastRole: context.messages.at(-1)?.role,
        toolResults: context.messages.flatMap((m) =>
          m.role === "toolResult"
            ? [
                {
                  name: m.toolName,
                  isError: m.isError,
                  text: m.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
                },
              ]
            : [],
        ),
      };
      this.calls.push(call);
      return this.respond(call);
    };
    this.faux.setResponses([step]);
  }

  models(): Models {
    const models = createModels();
    models.setProvider(this.faux.provider);
    return models;
  }

  /** Uma resposta só de texto, sem entregar pela ferramenta. */
  static text(text: string): AssistantMessage {
    return fauxAssistantMessage([fauxText(text)]);
  }
}

/** Uma rodada do implementador: as chamadas de ferramenta que ele faz ao receber um pedido da fábrica. */
export type ImplementerTurn = { tool: string; args: Record<string, string> }[];

/**
 * Roteiro do modelo nos testes da implementação: na conversa da SPEC entrega `spec`; na do implementador, cada pedido
 * novo da fábrica consome a próxima rodada do roteiro (que pode ser uma função, para decidir na hora) e, depois dos
 * resultados das ferramentas, responde em texto, encerrando a fase.
 */
export function scriptImplementer(
  model: FakeModel,
  spec: SpecDelivery,
  turns: (ImplementerTurn | (() => ImplementerTurn | Promise<ImplementerTurn>))[],
): void {
  const queue = [...turns];
  model.respond = async (call) => {
    if (call.tools.includes("entregar_spec")) return deliverSpec(spec);
    if (call.lastRole !== "user") return FakeModel.text("Fase concluída.");
    const next = queue.shift();
    const turn = typeof next === "function" ? await next() : (next ?? []);
    if (turn.length === 0) return FakeModel.text("Nada a fazer.");
    return fauxAssistantMessage(
      turn.map((c) => fauxToolCall(c.tool, c.args)),
      { stopReason: "toolUse" },
    );
  };
}

/** Rodada que escreve arquivos. */
export const write = (files: Record<string, string>): ImplementerTurn =>
  Object.entries(files).map(([caminho, conteudo]) => ({ tool: "escrever_arquivo", args: { caminho, conteudo } }));
