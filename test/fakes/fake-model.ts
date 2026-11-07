import {
  type AssistantMessage,
  type ClassifierContext,
  type ClassifierModel,
  type ClassifierResult,
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

/** Rejeita quando o signal do harness aborta a chamada do modelo. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted)
    return Promise.reject(signal.reason ?? new DOMException("This operation was aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("This operation was aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

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

/** Uma proposta da retrô, como o modelo a entrega pela ferramenta `entregar_retro`. */
export type RetroProposal = {
  tipo: "fabrica" | "conhecimento" | "repo-time";
  titulo: string;
  descricao: string;
};

/** Resposta do modelo que entrega a retrô de uma etapa (ou a consolidada) pela ferramenta da retrô. */
export const deliverRetro = (resumo: string, propostas: RetroProposal[] = []): AssistantMessage =>
  fauxAssistantMessage([fauxToolCall("entregar_retro", { resumo, propostas })], { stopReason: "toolUse" });

export const DEFAULT_SPEC: SpecDelivery = {
  spec: "Entregar o que o card pede.",
  tickets: [{ titulo: "Fazer o que o card pede", aceite: "O card está atendido" }],
};

/** Provedor de modelos faux: responde por roteiro e registra cada chamada. */
export class FakeModel {
  static readonly PROVIDER = "faux";
  readonly faux = fauxProvider({ provider: FakeModel.PROVIDER, models: [{ id: "spec-a" }, { id: "spec-b" }] });
  readonly calls: ModelCall[] = [];
  /** Como responder a cada chamada. Padrão: entrega uma SPEC genérica. O signal aborta modelos lentos nos testes. */
  respond: (call: ModelCall, signal?: AbortSignal) => AssistantMessage | Promise<AssistantMessage> = () =>
    deliverSpec(DEFAULT_SPEC);
  /**
   * Chamadas da retrô (as que oferecem `entregar_retro`), separadas de `calls`: a retrô roda ao fim de cada etapa e não
   * deve mudar o que os testes das outras etapas contam.
   */
  readonly retroCalls: ModelCall[] = [];
  /** Como responder à retrô. Padrão: uma retrô sem propostas. */
  respondRetro: (call: ModelCall, signal?: AbortSignal) => AssistantMessage | Promise<AssistantMessage> = () =>
    deliverRetro("Sem observações.");

  constructor() {
    const step: FauxResponseFactory = async (context, options, _state, model) => {
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
      const signal = options?.signal;
      let reply: AssistantMessage | Promise<AssistantMessage>;
      if (call.tools.includes("entregar_retro")) {
        this.retroCalls.push(call);
        reply = this.respondRetro(call, signal);
      } else {
        this.calls.push(call);
        reply = this.respond(call, signal);
      }
      return await raceAbort(Promise.resolve(reply), signal);
    };
    this.faux.setResponses([step]);
  }

  /** Id do classificador fake (System One), oferecido como `faux/<CLASSIFIER>`. */
  static readonly CLASSIFIER = "classificador";
  /** Contextos recebidos pelo classificador fake. */
  readonly classifierCalls: ClassifierContext[] = [];
  /** Como o classificador fake responde. Padrão: aceita com confiança total. */
  respondClassifier: (context: ClassifierContext) => ClassifierResult["answers"] = () => ({
    decisao: { type: "choice", choice: "aceita", confidence: 1, probabilities: { aceita: 1 } },
    categoria: { type: "choice", choice: "ok", confidence: 1, probabilities: { ok: 1 } },
    injecao: { type: "bool", probability: 0 },
  });

  models(): Models {
    const models = createModels();
    models.setProvider(this.faux.provider);
    const classifier = {
      id: FakeModel.CLASSIFIER,
      name: FakeModel.CLASSIFIER,
      provider: FakeModel.PROVIDER,
      api: "typesafe-system-one",
      type: "classifier",
      contextWindow: 262_000,
    } as unknown as ClassifierModel<"typesafe-system-one">;
    // O provedor faux não tem classificador: um proxy acrescenta o fake sem mudar o resto do `Models`.
    return new Proxy(models, {
      get: (target, prop, receiver) => {
        if (prop === "getModelsOfType")
          return (type: string, provider?: string) =>
            type === "classifier" && (!provider || provider === FakeModel.PROVIDER)
              ? [classifier]
              : target.getModelsOfType(type as "chat", provider);
        if (prop === "classify")
          return async (_model: unknown, context: ClassifierContext): Promise<ClassifierResult> => {
            this.classifierCalls.push(context);
            return {
              api: "typesafe-system-one",
              provider: FakeModel.PROVIDER,
              model: FakeModel.CLASSIFIER,
              answers: this.respondClassifier(context),
              stopReason: "stop",
              timestamp: Date.now(),
            };
          };
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
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
