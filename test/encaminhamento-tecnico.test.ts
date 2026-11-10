import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "../src/channel.js";
import { FakeClock } from "./fakes/fake-clock.js";
import { DEFAULT_SPEC, deliverSpec, FakeModel } from "./fakes/fake-model.js";
import { FakeTelegram } from "./fakes/fake-telegram.js";
import { api, events, eventually, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

// Observa a porta Channel, mas mantém seu adaptador real e o escritor de efeitos:
// o teste confere tanto o destinatário escolhido quanto a escrita externa efetiva.
const { perguntasNoChannel } = vi.hoisted(() => ({ perguntasNoChannel: vi.fn() }));
vi.mock("../src/channel.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/channel.js")>();
  return {
    ...original,
    createCardCommentChannel: (...args: Parameters<typeof original.createCardCommentChannel>) => {
      const canal = original.createCardCommentChannel(...args);
      return {
        ...canal,
        async ask(pergunta: Parameters<Channel["ask"]>[0]) {
          perguntasNoChannel(pergunta);
          return canal.ask(pergunta);
        },
      };
    },
  };
});

let factory: TestFactory | undefined;
beforeEach(() => perguntasNoChannel.mockClear());
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const LEAD = "tech-lead-do-projeto";
const PERGUNTA = "Qual versão do PostgreSQL devemos suportar?";
const BASE = "/tasks/exemplo/PROJ-1";
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

async function iniciar(inicio = "2025-06-10T10:00:00-03:00") {
  const clock = new FakeClock(inicio);
  const telegram = new FakeTelegram();
  const model = new FakeModel();
  let perguntou = false;
  model.respond = () => {
    if (perguntou) return deliverSpec(DEFAULT_SPEC);
    perguntou = true;
    return fauxAssistantMessage([fauxToolCall("perguntar_tecnico", { pergunta: PERGUNTA })], { stopReason: "toolUse" });
  };
  const people = [
    { id: USER, role: "po" as const },
    { id: LEAD, role: "tech_lead" as const },
  ];
  factory = await startTestFactory({
    cards: [{ key: "PROJ-1", title: "Conexão com banco", status: "A Fazer", assignee: USER }],
    model,
    clock,
    telegram,
    config: {
      people,
      calendar: {
        timezone: "America/Sao_Paulo",
        workdays: ["mon", "tue", "wed", "thu", "fri"],
        start: "09:00",
        end: "18:00",
        holidays: [],
      },
    },
  });
  const f = factory;
  await poll(f);
  await waitForStatus(f, "PROJ-1", "aguardando-humano");
  await eventually(() => expect(telegram.texts().some((texto) => texto.includes(PERGUNTA))).toBe(true));
  const detalhe = await api<{ questions: { n: number; askedAt: string }[] }>(f, "GET", BASE);
  expect(detalhe.questions[0]).toMatchObject({ n: 1, askedAt: new Date(inicio).toISOString() });
  const escrever = vi.spyOn(f.source, "addComment");
  return { f, clock, telegram, model, escrever };
}

async function responder(f: TestFactory, telegram: FakeTelegram, canal: string, texto: string) {
  if (canal === "web") {
    await api(f, "POST", `${BASE}/questions/1/answer`, { answer: texto });
  } else {
    const comando = `/responder exemplo/PROJ-1 1 ${texto}`;
    telegram.say(comando);
    await eventually(async () =>
      expect(await events(f)).toContainEqual(
        expect.objectContaining({
          type: "command",
          accepted: true,
          text: comando,
        }),
      ),
    );
  }
}

function encaminhamentos() {
  return perguntasNoChannel.mock.calls
    .map(([pergunta]) => pergunta as Parameters<Channel["ask"]>[0])
    .filter((pergunta) => pergunta.to === LEAD);
}

async function conferirEncaminhamento(f: TestFactory) {
  await eventually(() => expect(encaminhamentos()).toHaveLength(1));
  const enviado = encaminhamentos()[0];
  expect(enviado).toMatchObject({ card: "PROJ-1", to: LEAD });
  expect(enviado.text).toContain(PERGUNTA);
  expect(enviado.text).toContain("PROJ-1");
  expect(enviado.text).toMatch(/pergunta\s*1\b/i);
  await eventually(() => {
    const comentarios = f.source.commentsOf("PROJ-1").filter((c) => c.body.includes(PERGUNTA));
    expect(comentarios).toHaveLength(1);
    expect(comentarios[0].body).toContain("*mensagem automatizada*");
  });
}

describe("encaminhamento de pergunta técnica ao tech lead", () => {
  it.each(["web", "telegram"])("'não sei' na %s encaminha imediatamente e o prazo não duplica", async (canal) => {
    const { f, clock, telegram } = await iniciar();
    expect(encaminhamentos()).toEqual([]);

    await responder(f, telegram, canal, "não sei");

    // Não há avanço de relógio, /poll ou /resume para provocar o encaminhamento.
    await conferirEncaminhamento(f);
    clock.advanceTo("2025-06-10T12:00:00-03:00");
    await settle();
    await poll(f);
    clock.advanceTo("2025-06-11T18:00:00-03:00");
    await settle();
    await conferirEncaminhamento(f);
    expect(encaminhamentos()).toHaveLength(1);
  });

  it.each([
    {
      nome: "dentro do expediente",
      inicio: "2025-06-10T10:00:00-03:00",
      prazo: "2025-06-10T12:00:00-03:00",
    },
    {
      nome: "início antes do expediente",
      inicio: "2025-06-10T07:00:00-03:00",
      prazo: "2025-06-10T11:00:00-03:00",
    },
    {
      nome: "passagem de expediente e feriado estadual de SP",
      inicio: "2025-07-08T17:00:00-03:00",
      prazo: "2025-07-10T10:00:00-03:00",
    },
    {
      nome: "fim de semana e feriado municipal de Mogi",
      inicio: "2025-08-29T17:00:00-03:00",
      prazo: "2025-09-02T10:00:00-03:00",
    },
    {
      nome: "feriado nacional de Natal",
      inicio: "2025-12-24T17:00:00-03:00",
      prazo: "2025-12-26T10:00:00-03:00",
    },
  ])("sem resposta, encaminha só ao completar 120 minutos úteis: $nome", async ({ inicio, prazo }) => {
    const { f, clock } = await iniciar(inicio);

    clock.advanceTo(new Date(new Date(prazo).getTime() - 1));
    await settle();
    expect(encaminhamentos()).toEqual([]);

    clock.advanceTo(prazo);

    // O timer deve agir sozinho no limite exato, sem depender da busca na Fonte.
    await conferirEncaminhamento(f);
  });

  it.each(["web", "telegram"])(
    "resposta resolutiva pela %s antes do limite impede a escalada por prazo",
    async (canal) => {
      const { f, clock, telegram } = await iniciar();
      clock.advanceTo("2025-06-10T11:59:59.999-03:00");
      await responder(f, telegram, canal, "PostgreSQL 16 com TLS obrigatório.");
      await waitForStatus(f, "PROJ-1", "concluida");

      clock.advanceTo("2025-06-10T12:00:00-03:00");
      await settle();
      await poll(f);
      clock.advanceTo("2025-06-11T18:00:00-03:00");
      await settle();

      expect(encaminhamentos()).toEqual([]);
      expect(f.source.commentsOf("PROJ-1").filter((c) => /encaminha|tech.?lead/i.test(c.body))).toEqual([]);
    },
  );

  it.each(["não sei", "prazo"])(
    "sem tech lead nas pessoas do projeto, bloqueia %s com aviso e não envia a outro destinatário",
    async (motivo) => {
      const { f, clock, telegram, escrever } = await iniciar();
      // Revoga a pessoa depois da disponibilização, antes de surgir a necessidade de envio.
      const atual = await api<{ people: { id: string; role: string }[] }>(f, "GET", "/projetos/exemplo/configuracao");
      await api(f, "PUT", "/projetos/exemplo/configuracao", {
        ...atual,
        people: atual.people.filter((p) => p.role !== "tech_lead"),
      });
      if (motivo === "não sei") await responder(f, telegram, "web", "não sei");
      else clock.advanceTo("2025-06-10T12:00:00-03:00");

      await eventually(() => {
        expect(
          telegram
            .texts()
            .some(
              (texto) => /bloquead/i.test(texto) && /tech.?lead|líder técnico/i.test(texto) && /projeto/i.test(texto),
            ),
        ).toBe(true);
      });
      expect(perguntasNoChannel).not.toHaveBeenCalled();
      expect(escrever).not.toHaveBeenCalled();
      expect(f.source.commentsOf("PROJ-1").some((c) => c.body.includes(PERGUNTA))).toBe(false);
    },
  );
});
