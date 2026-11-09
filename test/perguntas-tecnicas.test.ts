import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SPEC, deliverSpec, FakeModel } from "./fakes/fake-model.js";
import { FakeTelegram } from "./fakes/fake-telegram.js";
import {
  api,
  events,
  eventually,
  poll,
  startTestFactory,
  statusOf,
  type TestFactory,
  USER,
  waitForStatus,
} from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const PERGUNTA = "Qual versão do PostgreSQL devemos suportar na conexão?";
const RESPOSTA = "Suportar PostgreSQL 16 com TLS obrigatório.";
const BASE = "/tasks/exemplo/PROJ-1";
const pessoas = [
  { id: USER, role: "po" as const },
  { id: "lider-projeto", role: "tech_lead" as const },
];

interface Detalhe {
  status: string;
  questions: { n: number; to: string; text: string; answer: string | null }[];
}

// Contrato novo: a ferramenta perguntar_tecnico suspende a etapa e pergunta ao
// usuário do projeto, em vez de usar o fluxo de perguntas de negócio ao PO.
function modeloComDuvida() {
  const model = new FakeModel();
  let perguntou = false;
  model.respond = (call) => {
    if (!perguntou && call.tools.includes("perguntar_tecnico")) {
      perguntou = true;
      return fauxAssistantMessage([fauxToolCall("perguntar_tecnico", { pergunta: PERGUNTA })], {
        stopReason: "toolUse",
      });
    }
    return deliverSpec(DEFAULT_SPEC);
  };
  return model;
}

async function iniciar(permitirUsuario = true) {
  const telegram = new FakeTelegram();
  const model = modeloComDuvida();
  factory = await startTestFactory({
    cards: [{ key: "PROJ-1", title: "Conexão com banco", status: "A Fazer", assignee: USER }],
    model,
    telegram,
    config: { people: permitirUsuario ? pessoas : pessoas.filter((p) => p.id !== USER) },
  });
  await poll(factory);
  await eventually(() => expect(model.calls.length).toBeGreaterThan(0));
  expect(model.calls[0].tools).toContain("perguntar_tecnico");
  return { f: factory, model, telegram };
}

async function pendente() {
  const contexto = await iniciar();
  await waitForStatus(contexto.f, "PROJ-1", "aguardando-humano");
  const detalhe = await api<Detalhe>(contexto.f, "GET", BASE);
  expect(detalhe.questions).toEqual([expect.objectContaining({ n: 1, to: USER, text: PERGUNTA, answer: null })]);
  await eventually(() => {
    expect(contexto.telegram.texts()).toContainEqual(expect.stringContaining(PERGUNTA));
  });
  const mensagem = contexto.telegram.texts().find((texto) => texto.includes(PERGUNTA));
  expect(mensagem).toContain("PROJ-1");
  expect(mensagem).toContain("Toque em Responder");
  return contexto;
}

async function responder(f: TestFactory, telegram: FakeTelegram, canal: string, texto: string) {
  if (canal === "web") {
    await api(f, "POST", `${BASE}/questions/1/answer`, { answer: texto });
  } else {
    telegram.say(`/responder exemplo/PROJ-1 1 ${texto}`);
    await eventually(async () => {
      expect(await events(f)).toContainEqual(
        expect.objectContaining({
          type: "command",
          accepted: true,
          text: `/responder exemplo/PROJ-1 1 ${texto}`,
        }),
      );
    });
  }
}

describe("perguntas técnicas: web e Telegram", () => {
  it.each(["web", "telegram"])(
    "resposta resolutiva pela %s encerra a espera e retoma a tarefa com a resposta",
    async (canal) => {
      const { f, model, telegram } = await pendente();
      const chamadasAntes = model.calls.length;

      await responder(f, telegram, canal, RESPOSTA);

      // Não há /poll nem /resume: o recebimento da resposta deve acordar a tarefa.
      await waitForStatus(f, "PROJ-1", "concluida");
      const detalhe = await api<Detalhe>(f, "GET", BASE);
      expect(detalhe.questions).toEqual([expect.objectContaining({ n: 1, text: PERGUNTA, answer: RESPOSTA })]);
      expect(model.calls.length).toBeGreaterThan(chamadasAntes);
      expect(model.calls.slice(chamadasAntes).some((call) => call.input.includes(RESPOSTA))).toBe(true);
      expect(await events(f)).toContainEqual(
        expect.objectContaining({
          type: "question",
          target: "PROJ-1",
          n: 1,
          status: "respondida",
        }),
      );
    },
  );

  it.each(["web", "telegram"])(
    "'não sei' pela %s é associada à pergunta para encaminhamento, não resolve a tarefa",
    async (canal) => {
      const { f, model, telegram } = await pendente();
      const chamadasAntes = model.calls.length;

      await responder(f, telegram, canal, "não sei");

      // O evento é o sinal para o fluxo de encaminhamento (implementado em outro ticket).
      await eventually(async () => {
        expect(await events(f)).toContainEqual(
          expect.objectContaining({
            type: "question",
            target: "PROJ-1",
            n: 1,
            status: "encaminhar",
            text: "não sei",
          }),
        );
      });
      const detalhe = await api<Detalhe>(f, "GET", BASE);
      expect(detalhe.questions[0]).toMatchObject({ n: 1, text: PERGUNTA, answer: null });
      expect(model.calls).toHaveLength(chamadasAntes);
      expect(await statusOf(f, "PROJ-1")).not.toBe("concluida");
      expect((await events(f)).filter((e) => e.type === "question" && e.status === "respondida")).toEqual([]);
    },
  );

  it("bloqueia destinatário fora das pessoas do projeto antes de expor a pergunta no Telegram", async () => {
    const { f, telegram } = await iniciar(false);

    await waitForStatus(f, "PROJ-1", "bloqueada");

    const detalhe = await api<Detalhe>(f, "GET", BASE);
    expect(detalhe.status).toBe("bloqueada");
    await eventually(() => {
      expect(telegram.texts().some((texto) => /bloquead/i.test(texto) && /projeto/i.test(texto))).toBe(true);
    });
    expect(telegram.texts().some((texto) => texto.includes(PERGUNTA))).toBe(false);
    expect((await events(f)).filter((e) => e.type === "question" && e.status === "enviada")).toEqual([]);
  });

  it("uma origem Telegram não autorizada não responde nem acorda a tarefa", async () => {
    const { f, model, telegram } = await pendente();
    const chamadasAntes = model.calls.length;
    telegram.say(`/responder exemplo/PROJ-1 1 ${RESPOSTA}`, { user: "intruso" });

    await eventually(async () => {
      expect(await events(f)).toContainEqual(
        expect.objectContaining({
          type: "command",
          user: "intruso",
          accepted: false,
        }),
      );
    });

    expect(await statusOf(f, "PROJ-1")).toBe("aguardando-humano");
    expect((await api<Detalhe>(f, "GET", BASE)).questions[0].answer).toBeNull();
    expect(model.calls).toHaveLength(chamadasAntes);
  });
});
