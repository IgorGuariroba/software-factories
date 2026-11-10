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

const MARK = "\n\n*mensagem automatizada*";
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
  f.source.commentsOf(key).filter((c) => c.author === USER && /pergunta \d+:/i.test(c.body));
const specComments = (f: TestFactory, key: string) =>
  f.source.commentsOf(key).filter((c) => c.body.split("\n")[0] === "SPEC" && c.body.endsWith(MARK));

describe("perguntas de negócio ao PO", () => {
  it("resposta local em dry-run retoma a SPEC sem publicar na Fonte", async () => {
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o calendário?");
    factory = await startTestFactory({ cards: [card("PROJ-1")], model, dryRun: true });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    await api(factory, "POST", "/tasks/exemplo/PROJ-1/questions/1/answer", {
      answer: "Segunda a sexta, 9h às 18h; excluir feriados de Mogi das Cruzes/SP.",
    });
    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(model.calls[1]?.input).toContain("feriados de Mogi das Cruzes/SP");
    expect(factory.source.commentsOf("PROJ-1")).toEqual([]);
  });
  it("permite revisar a pergunta antes de enviar ao Jira e avisar no Teams", async () => {
    const sent: unknown[] = [];
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador? DB_PASSWORD=senha-ficticia");
    factory = await startTestFactory({
      cards: [card("PROJ-1")],
      model,
      teams: {
        send: async (message) => {
          sent.push(message);
        },
      },
      config: {
        questionApproval: true,
        source: { type: "jira", project: "PROJ", assignee: USER, baseUrl: "https://jira.example.invalid" },
        people: [{ id: PO, role: "po", teamsUserId: "8:orgid:po" }],
      },
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    expect(questionComments(factory, "PROJ-1")).toEqual([]);
    expect(sent).toEqual([]);
    factory = await factory.restart();
    await poll(factory);
    expect(questionComments(factory, "PROJ-1")).toEqual([]);
    expect(sent).toEqual([]);
    const preview = await api<{ comment: string; teamsMessage: string; revision: string }>(
      factory,
      "GET",
      "/tasks/exemplo/PROJ-1/questions/1",
    );
    expect(preview.comment).toContain("Qual o separador?");
    expect(preview.comment).not.toContain("senha-ficticia");
    const url = `${factory.url}/tasks/exemplo/PROJ-1/questions/1/approve`;
    const stale = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: "inválida" }),
    });
    expect(stale.status).toBe(409);
    expect(questionComments(factory, "PROJ-1")).toEqual([]);
    await api(factory, "POST", "/tasks/exemplo/PROJ-1/questions/1/approve", { revision: preview.revision });
    expect(questionComments(factory, "PROJ-1")[0]?.body).toBe(preview.comment);
    expect(sent).toEqual([expect.objectContaining({ text: preview.teamsMessage })]);
    const repeat = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: preview.revision }),
    });
    expect(repeat.status).toBe(409);
    expect(sent).toHaveLength(1);
  });
  it("um rascunho criado em dry-run pode ser revisto novamente e publicado após reiniciar em modo real", async () => {
    const sent: unknown[] = [];
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador?");
    const config = {
      dryRun: true,
      questionApproval: true,
      source: { type: "jira" as const, project: "PROJ", assignee: USER, baseUrl: "https://jira.example.invalid" },
      people: [{ id: PO, role: "po" as const, teamsUserId: "8:orgid:po" }],
    };
    factory = await startTestFactory({
      cards: [card("PROJ-1")],
      model,
      config,
      teams: {
        send: async (message) => {
          sent.push(message);
        },
      },
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    const dry = await api<{ revision: string }>(factory, "GET", "/tasks/exemplo/PROJ-1/questions/1");
    factory = await factory.restart({ config: { ...config, dryRun: false } });
    const live = await api<{ revision: string; comment: string }>(factory, "GET", "/tasks/exemplo/PROJ-1/questions/1");
    expect(live.revision).not.toBe(dry.revision);
    await api(factory, "POST", "/tasks/exemplo/PROJ-1/questions/1/approve", { revision: live.revision });
    expect(questionComments(factory, "PROJ-1")[0]?.body).toBe(live.comment);
    expect(sent).toHaveLength(1);
    expect(factory.source.cards[0]?.status).toBe("A Fazer");
  });

  it("não publica pergunta aprovada quando a configuração está em dry-run", async () => {
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador?");
    factory = await startTestFactory({
      dryRun: true,
      cards: [card("PROJ-1")],
      model,
      config: { questionApproval: true },
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    const preview = await api<{ revision: string; dryRun: boolean }>(
      factory,
      "GET",
      "/tasks/exemplo/PROJ-1/questions/1",
    );
    expect(preview.dryRun).toBe(true);
    const response = await fetch(`${factory.url}/tasks/exemplo/PROJ-1/questions/1/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: preview.revision }),
    });
    expect(response.status).toBe(409);
    expect(factory.source.commentsOf("PROJ-1")).toEqual([]);
  });

  it("pergunta barrada por guardrail na aprovação volta a rascunho e pode ser aprovada depois", async () => {
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador?");
    factory = await startTestFactory({ cards: [card("PROJ-1")], model, config: { questionApproval: true } });
    const f = factory;
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-humano");
    const preview = await api<{ revision: string }>(f, "GET", "/tasks/exemplo/PROJ-1/questions/1");
    const stored = f.source.cards[0];
    if (stored) stored.assignee = "maria";
    const post = () =>
      fetch(`${f.url}/tasks/exemplo/PROJ-1/questions/1/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: preview.revision }),
      });
    expect((await post()).status).toBe(409);
    expect(questionComments(f, "PROJ-1")).toEqual([]);
    if (stored) stored.assignee = USER;
    expect((await post()).status).toBe(200);
    expect(questionComments(f, "PROJ-1")).toHaveLength(1);
  });

  it("no ensaio não publica SPEC se o modelo não propuser uma pergunta", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1")], config: { questionApproval: true } });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "bloqueada");
    expect(specComments(factory, "PROJ-1")).toEqual([]);
  });

  it("avisa o PO no Teams com link do card, uma única vez inclusive após reinício", async () => {
    const sent: { userId: string; text: string }[] = [];
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador?");
    factory = await startTestFactory({
      cards: [card("PROJ-1")],
      model,
      teams: {
        send: async (message) => {
          sent.push(message);
        },
      },
      config: {
        source: { type: "jira", project: "PROJ", assignee: USER, baseUrl: "https://jira.example.invalid" },
        people: [{ id: PO, role: "po", teamsUserId: "8:orgid:po", name: "Maria Souza" }],
      },
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId: "8:orgid:po" });
    const title = factory.source.cards[0]?.title ?? "";
    expect(sent[0]?.text).toBe(
      `Olá, Maria! Aguardamos a sua resposta à pergunta feita no card PROJ-1 (${title}). ` +
        "Pode responder direto no card: https://jira.example.invalid/browse/PROJ-1\n\n*mensagem automatizada*",
    );
    factory = await factory.restart();
    await poll(factory);
    expect(sent).toHaveLength(1);
  });
  it("não envia aviso pelo Teams no dry-run", async () => {
    const sent: unknown[] = [];
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador?");
    factory = await startTestFactory({
      dryRun: true,
      cards: [card("PROJ-1")],
      model,
      teams: {
        send: async (message) => {
          sent.push(message);
        },
      },
      config: {
        source: { type: "jira", project: "PROJ", assignee: USER, baseUrl: "https://jira.example.invalid" },
        people: [{ id: PO, role: "po", teamsUserId: "8:orgid:po" }],
      },
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    expect(sent).toEqual([]);
  });

  it("não repete envio Teams de resultado incerto após reinício", async () => {
    let attempts = 0;
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador?");
    factory = await startTestFactory({
      cards: [card("PROJ-1")],
      model,
      teams: {
        send: async () => {
          attempts++;
          throw new Error("resposta perdida");
        },
      },
      config: {
        source: { type: "jira", project: "PROJ", assignee: USER, baseUrl: "https://jira.example.invalid" },
        people: [{ id: PO, role: "po", teamsUserId: "8:orgid:po" }],
      },
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    expect(attempts).toBe(1);
    expect(await events(factory)).toContainEqual(
      expect.objectContaining({ type: "error", message: expect.stringContaining("aviso Teams não confirmado") }),
    );
    factory = await factory.restart();
    await poll(factory);
    expect(attempts).toBe(1);
  });

  it("a pergunta do grill vira comentário no card mencionando o PO; a tarefa aguarda e a próxima avança", async () => {
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "O CSV usa vírgula ou ponto e vírgula?");
    factory = await startTestFactory({ cards: [card("PROJ-1"), card("PROJ-2")], model });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    await waitForStatus(factory, "PROJ-2", "concluida");

    const [question] = questionComments(factory, "PROJ-1");
    expect(questionComments(factory, "PROJ-1")).toHaveLength(1);
    expect(question?.body.endsWith(MARK)).toBe(true);
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

  it("com revisão de perguntas, o lembrete vira rascunho e só é publicado após aprovação da prévia", async () => {
    const clock = new FakeClock("2026-11-09T09:00:00-03:00");
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador do CSV?");
    factory = await startTestFactory({
      cards: [card("PROJ-1")],
      model,
      clock,
      config: { calendar: CALENDAR, questionApproval: true },
    });
    const f = factory;
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-humano");
    const question = await api<{ revision: string }>(f, "GET", "/tasks/exemplo/PROJ-1/questions/1");
    await api(f, "POST", "/tasks/exemplo/PROJ-1/questions/1/approve", { revision: question.revision });

    clock.advanceTo("2026-11-09T13:00:00-03:00");
    let preview: { comment: string; revision: string } | undefined;
    await eventually(async () => {
      preview = await api(f, "GET", "/tasks/exemplo/PROJ-1/questions/1/reminder");
    });
    expect(reminders(f, "PROJ-1")).toEqual([]);
    expect(preview?.comment).toContain("Lembrete da pergunta 1");
    const url = `${f.url}/tasks/exemplo/PROJ-1/questions/1/reminder/approve`;
    const post = (revision: string) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision }),
      });
    expect((await post("inválida")).status).toBe(409);
    expect(reminders(f, "PROJ-1")).toEqual([]);
    expect((await post(preview?.revision ?? "")).status).toBe(200);
    expect(reminders(f, "PROJ-1").map((c) => c.body)).toEqual([preview?.comment]);
    expect((await post(preview?.revision ?? "")).status).toBe(409);
  });

  it("lembrete barrado por guardrail na aprovação volta a rascunho e pode ser aprovado depois", async () => {
    const clock = new FakeClock("2026-11-09T09:00:00-03:00");
    const model = new FakeModel();
    grillAsksAbout(model, "PROJ-1", "Qual o separador do CSV?");
    factory = await startTestFactory({
      cards: [card("PROJ-1")],
      model,
      clock,
      config: { calendar: CALENDAR, questionApproval: true },
    });
    const f = factory;
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-humano");
    const question = await api<{ revision: string }>(f, "GET", "/tasks/exemplo/PROJ-1/questions/1");
    await api(f, "POST", "/tasks/exemplo/PROJ-1/questions/1/approve", { revision: question.revision });
    clock.advanceTo("2026-11-09T13:00:00-03:00");
    let preview: { revision: string } | undefined;
    await eventually(async () => {
      preview = await api(f, "GET", "/tasks/exemplo/PROJ-1/questions/1/reminder");
    });
    const stored = f.source.cards[0];
    if (stored) stored.assignee = "maria";
    const post = () =>
      fetch(`${f.url}/tasks/exemplo/PROJ-1/questions/1/reminder/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: preview?.revision }),
      });
    expect((await post()).status).toBe(409);
    expect(reminders(f, "PROJ-1")).toEqual([]);
    if (stored) stored.assignee = USER;
    expect((await post()).status).toBe(200);
    expect(reminders(f, "PROJ-1")).toHaveLength(1);
  });

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
