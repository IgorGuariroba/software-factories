import {
  type AssistantMessage,
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
}

export interface SpecDelivery {
  spec: string;
  tickets: { titulo: string; aceite: string }[];
}

/** Resposta do modelo que entrega a SPEC e os Tickets pela ferramenta da etapa. */
export const deliverSpec = (delivery: SpecDelivery): AssistantMessage =>
  fauxAssistantMessage([fauxToolCall("entregar_spec", { ...delivery })], { stopReason: "toolUse" });

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
      const call = { model: model.id, context: JSON.stringify(context) };
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
