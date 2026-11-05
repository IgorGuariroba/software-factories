import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "./fakes/fake-clock.js";
import { askPo, DEFAULT_SPEC, deliverSpec, FakeModel, type ModelCall } from "./fakes/fake-model.js";
import {
  api,
  events,
  eventually,
  PO,
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

const PREFIX = "\u{1F916} [fábrica]";
const MENTION = `[~accountid:${PO}]`;
const card = (key: string, extra: object = {}) => ({
  key,
  title: `Exportar relatório ${key}`,
  status: "A Fazer",
  assignee: USER,
  ...extra,
});

/** O grill pergunta ao PO sobre o PROJ-1 até receber a resposta; os outros cards ele especifica direto. */
function grillAsksAbout(model: FakeModel, key: string, question: string) {
  model.respond = (call: ModelCall) =>
    call.input.includes(`# Card ${key}`) && !call.input.includes("Resposta do PO")
      ? askPo(question)
      : deliverSpec(DEFAULT_SPEC);
}

/** Deixa a fábrica reagir (ex.: ao que o relógio falso disparou) antes de conferir que algo *não* aconteceu. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const questionComments = (f: TestFactory, key: string) =>
  f.source.commentsOf(key).filter((c) => c.author === USER && c.body.includes(MENTION));
const specComments = (f: TestFactory, key: string) =>
  f.source.commentsOf(key).filter((c) => c.body.split("\n")[0] === `${PREFIX} SPEC`);

describe("perguntas de negócio ao PO", () => {
  it("a pergunta do grill vira comentário no card mencionando o PO; a tarefa aguarda e a próxima avança", async () => {
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "O CSV usa vírgula ou ponto e vírgula?");
    factory = await startTestFactory({ cards: [card("PROJ-1"), card("PROJ-2")], model });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    await waitForStatus(factory, "PROJ-2", "concluida");

    const [question] = questionComments(factory, "PROJ-1");
    expect(questionComments(factory, "PROJ-1")).toHaveLength(1);
    expect(question?.body.startsWith(PREFIX)).toBe(true);
    expect(question?.body).toContain(MENTION);
    expect(question?.body).toContain("O CSV usa vírgula ou ponto e vírgula?");
    expect(specComments(factory, "PROJ-1")).toEqual([]);
    expect(await events(factory)).toContainEqual(
      expect.objectContaining({ type: "task", key: "PROJ-1", status: "aguardando-humano" }),
    );
  });

  it("falha ao conferir uma resposta não impede outras respostas nem a busca de novos cards", async () => {
    const model = new FakeModel();
    model.respond = (call) =>
      call.input.includes("Resposta do PO") ? deliverSpec(DEFAULT_SPEC) : askPo("Qual o separador?");
    factory = await startTestFactory({ cards: [card("PROJ-1"), card("PROJ-2")], model });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    await waitForStatus(factory, "PROJ-2", "aguardando-humano");
    factory.source.humanComment("PROJ-2", PO, "Vírgula.");
    factory.source.cards.push(card("PROJ-3"));
    const listComments = factory.source.listComments.bind(factory.source);
    factory.source.listComments = async (key) => {
      if (key === "PROJ-1") throw new Error("fonte indisponível");
      return listComments(key);
    };

    await poll(factory);

    await waitForStatus(factory, "PROJ-2", "concluida");
    await waitForStatus(factory, "PROJ-3", "aguardando-humano");
    expect(await events(factory)).toContainEqual(
      expect.objectContaining({
        type: "error",
        project: "exemplo",
        target: "PROJ-1",
        message: expect.stringContaining("fonte indisponível"),
      }),
    );
  });

  it("a resposta do PO no card acorda a tarefa, e o grill especifica com ela", async () => {
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "O CSV usa vírgula ou ponto e vírgula?");
    factory = await startTestFactory({ cards: [card("PROJ-1")], model });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");

    factory.source.humanComment("PROJ-1", PO, "Ponto e vírgula, sempre.");
    await poll(factory);

    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.input).toContain("Ponto e vírgula, sempre.");
    expect(specComments(factory, "PROJ-1")).toHaveLength(1);
    expect(await events(factory)).toContainEqual(
      expect.objectContaining({ type: "question", target: "PROJ-1", status: "respondida", to: PO }),
    );
  });

  it("só um comentário do PO depois da pergunta é resposta: outra pessoa ou um comentário antigo não acordam", async () => {
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador?");
    factory = await startTestFactory({ cards: [card("PROJ-1")], model });
    factory.source.humanComment("PROJ-1", PO, "Comentário do PO de antes da pergunta.");
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");

    factory.source.humanComment("PROJ-1", "outra-pessoa", "Acho que é vírgula.");
    await poll(factory);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await statusOf(factory, "PROJ-1")).toBe("aguardando-humano");
    expect(model.calls).toHaveLength(1);
  });

  it("pausada enquanto aguarda, a tarefa respondida espera ser retomada para seguir", async () => {
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador?");
    factory = await startTestFactory({ cards: [card("PROJ-1")], model });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");

    await api(factory, "POST", "/tasks/exemplo/PROJ-1/pause");
    factory.source.humanComment("PROJ-1", PO, "Ponto e vírgula.");
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "pausada");
    expect(model.calls).toHaveLength(1);

    await api(factory, "POST", "/tasks/exemplo/PROJ-1/resume");
    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(model.calls[1]?.input).toContain("Ponto e vírgula.");
  });

  it("cancelar uma tarefa que aguarda o PO a encerra", async () => {
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador?");
    factory = await startTestFactory({ cards: [card("PROJ-1")], model });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");

    await api(factory, "POST", "/tasks/exemplo/PROJ-1/cancel");

    await waitForStatus(factory, "PROJ-1", "cancelada");
    factory.source.humanComment("PROJ-1", PO, "Ponto e vírgula.");
    await poll(factory);
    await settle();
    expect(await statusOf(factory, "PROJ-1")).toBe("cancelada");
    expect(model.calls).toHaveLength(1);
  });

  it("a espera sobrevive a um reinício: a resposta depois dele acorda a tarefa sem repetir a pergunta", async () => {
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador?");
    factory = await startTestFactory({ cards: [card("PROJ-1")], model });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");

    factory = await factory.restart();
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    factory.source.humanComment("PROJ-1", PO, "Ponto e vírgula.");
    await poll(factory);

    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(questionComments(factory, "PROJ-1")).toHaveLength(1);
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.input).toContain("Ponto e vírgula.");
  });
});

/** Expediente do projeto nos testes de prazo: segunda a sexta, 09:00–18:00, em São Paulo (UTC-3, sem horário de verão). */
const CALENDAR = {
  timezone: "America/Sao_Paulo",
  workdays: ["mon", "tue", "wed", "thu", "fri"] as ("mon" | "tue" | "wed" | "thu" | "fri")[],
  start: "09:00",
  end: "18:00",
  holidays: [] as string[],
};
const reminders = (f: TestFactory, key: string) =>
  questionComments(f, key).filter((c) => c.body.includes("Lembrete da pergunta 1"));
const notices = async (f: TestFactory) => (await events(f)).filter((e) => e.type === "notify");

describe("escalonamento em horas úteis", () => {
  async function askedAt(at: string, calendar = CALENDAR) {
    const clock = new FakeClock(at);
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador do CSV?");
    factory = await startTestFactory({ cards: [card("PROJ-1")], model, clock, config: { calendar } });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    return { clock, f: factory };
  }

  it("cruzando o fim de semana: lembrete ao PO após 4 h úteis e aviso ao usuário após 1 dia útil", async () => {
    // Sexta 16:00: restam 2 h úteis na sexta; segunda completa as 4 h às 11:00 e o dia útil (9 h) às 16:00.
    const { clock, f } = await askedAt("2026-11-06T16:00:00-03:00");

    clock.advanceTo("2026-11-07T12:00:00-03:00"); // sábado
    clock.advanceTo("2026-11-09T10:59:00-03:00"); // segunda, antes do prazo
    await settle();
    expect(reminders(f, "PROJ-1")).toEqual([]);

    clock.advanceTo("2026-11-09T11:00:00-03:00");
    await eventually(() => expect(reminders(f, "PROJ-1")).toHaveLength(1));
    expect(reminders(f, "PROJ-1")[0]?.body).toContain(MENTION);
    expect(await notices(f)).toEqual([]);

    clock.advanceTo("2026-11-09T15:59:00-03:00");
    await settle();
    expect(await notices(f)).toEqual([]);

    clock.advanceTo("2026-11-09T16:00:00-03:00");
    await eventually(async () =>
      expect(await notices(f)).toMatchObject([
        { type: "notify", target: "PROJ-1", reason: "pergunta-sem-resposta", at: "2026-11-09T19:00:00.000Z" },
      ]),
    );
    expect(reminders(f, "PROJ-1")).toHaveLength(1);
    expect(await statusOf(f, "PROJ-1")).toBe("aguardando-humano");
  });

  it("cruzando a noite: a contagem para às 18:00 e recomeça às 09:00 do dia seguinte", async () => {
    // Terça 15:00: 3 h úteis na terça; a quarta completa as 4 h às 10:00 e o dia útil às 15:00.
    const { clock, f } = await askedAt("2026-11-10T15:00:00-03:00");

    clock.advanceTo("2026-11-10T19:00:00-03:00"); // 4 h de relógio, mas só 3 h úteis
    clock.advanceTo("2026-11-11T09:59:00-03:00");
    await settle();
    expect(reminders(f, "PROJ-1")).toEqual([]);

    clock.advanceTo("2026-11-11T10:00:00-03:00");
    await eventually(() => expect(reminders(f, "PROJ-1")).toHaveLength(1));

    clock.advanceTo("2026-11-11T15:00:00-03:00");
    await eventually(async () => expect(await notices(f)).toHaveLength(1));
  });

  it("feriados do calendário não contam como horas úteis", async () => {
    // Sexta 16:00 com a segunda feriado: as 4 h úteis se completam na terça às 11:00.
    const { clock, f } = await askedAt("2026-11-06T16:00:00-03:00", { ...CALENDAR, holidays: ["2026-11-09"] });

    clock.advanceTo("2026-11-09T11:00:00-03:00");
    await settle();
    expect(reminders(f, "PROJ-1")).toEqual([]);

    clock.advanceTo("2026-11-10T11:00:00-03:00");
    await eventually(() => expect(reminders(f, "PROJ-1")).toHaveLength(1));
  });

  it("respondida antes do prazo, a pergunta não gera lembrete nem aviso", async () => {
    const { clock, f } = await askedAt("2026-11-06T16:00:00-03:00");

    f.source.humanComment("PROJ-1", PO, "Ponto e vírgula.");
    await poll(f);
    await waitForStatus(f, "PROJ-1", "concluida");
    clock.advanceTo("2026-11-10T12:00:00-03:00");
    await settle();

    expect(reminders(f, "PROJ-1")).toEqual([]);
    expect(await notices(f)).toEqual([]);
  });

  it("a resposta que chega sem busca na Fonte é achada quando a tarefa acorda num prazo", async () => {
    const { clock, f } = await askedAt("2026-11-06T16:00:00-03:00");

    f.source.humanComment("PROJ-1", PO, "Ponto e vírgula.");
    clock.advanceTo("2026-11-09T11:00:00-03:00");

    await waitForStatus(f, "PROJ-1", "concluida");
    expect(reminders(f, "PROJ-1")).toEqual([]);
  });

  it("os prazos sobrevivem a um reinício durante a espera", async () => {
    const { clock, f } = await askedAt("2026-11-06T16:00:00-03:00");

    factory = await f.restart();
    clock.advanceTo("2026-11-09T11:00:00-03:00");

    await eventually(() => expect(reminders(factory as TestFactory, "PROJ-1")).toHaveLength(1));
  });
});

describe("card vazio ou raso", () => {
  it("força a pergunta ao PO antes da SPEC, sem chamar o grill; a resposta entra no contexto dele", async () => {
    const model = new FakeModel();
    factory = await startTestFactory({ cards: [card("PROJ-1", { description: undefined })], model });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");

    expect(model.calls).toEqual([]);
    expect(specComments(factory, "PROJ-1")).toEqual([]);
    expect(questionComments(factory, "PROJ-1")).toHaveLength(1);
    expect(questionComments(factory, "PROJ-1")[0]?.body).toContain("critérios de aceite");

    factory.source.humanComment("PROJ-1", PO, "Exportar o relatório mensal de vendas em CSV com separador ';'.");
    await poll(factory);

    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.input).toContain("Exportar o relatório mensal de vendas em CSV com separador ';'.");
    expect(specComments(factory, "PROJ-1")).toHaveLength(1);
  });

  it("uma descrição curta com uma discussão humana suficiente no card não é rasa", async () => {
    const model = new FakeModel();
    factory = await startTestFactory({ cards: [card("PROJ-1", { description: "Exportar CSV." })], model });
    factory.source.humanComment(
      "PROJ-1",
      "analista",
      "O relatório mensal de vendas precisa sair em CSV, com separador ';' e cabeçalho com data, valor e cliente.",
    );

    await poll(factory);

    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(questionComments(factory, "PROJ-1")).toEqual([]);
  });
});

describe("guardrails e dry-run das perguntas", () => {
  it("sem PO nas pessoas do projeto, a tarefa fica bloqueada em vez de perguntar a qualquer um", async () => {
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador?");
    factory = await startTestFactory({ cards: [card("PROJ-1")], model, config: { people: [] } });

    await poll(factory);

    await waitForStatus(factory, "PROJ-1", "bloqueada");
    expect(questionComments(factory, "PROJ-1")).toEqual([]);
    expect(await events(factory)).toContainEqual(
      expect.objectContaining({
        type: "task",
        key: "PROJ-1",
        status: "bloqueada",
        reason: expect.stringMatching(/PO/),
      }),
    );
  });

  it("no dry-run a pergunta e o lembrete só ficam nos eventos; a resposta real no card ainda acorda a tarefa", async () => {
    const clock = new FakeClock("2026-11-06T16:00:00-03:00");
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador do CSV?");
    factory = await startTestFactory({
      cards: [card("PROJ-1")],
      model,
      clock,
      dryRun: true,
      config: { calendar: CALENDAR },
    });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    clock.advanceTo("2026-11-09T11:00:00-03:00");
    const mentions = async () =>
      (await events(factory as TestFactory)).filter((e) => e.type === "write" && e.action === "mention");
    await eventually(async () => expect(await mentions()).toHaveLength(2));

    expect(factory.source.commentsOf("PROJ-1")).toEqual([]);
    const [question, reminder] = await mentions();
    expect(question).toMatchObject({ target: "PROJ-1", dryRun: true });
    expect(String(question?.content)).toContain(MENTION);
    expect(String(question?.content)).toContain("Qual o separador do CSV?");
    expect(String(reminder?.content)).toContain("Lembrete da pergunta 1");

    factory.source.humanComment("PROJ-1", PO, "Ponto e vírgula.");
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(model.calls[1]?.input).toContain("Ponto e vírgula.");
  });
});
