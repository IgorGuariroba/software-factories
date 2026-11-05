import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SPEC, deliverSpec, FakeModel } from "./fakes/fake-model.js";
import {
  events,
  eventually,
  hold,
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

const PREFIX = "🤖 [fábrica]";
const card = (extra: object = {}) => ({
  key: "PROJ-1",
  title: "Exportar relatório em CSV",
  status: "A Fazer",
  assignee: USER,
  ...extra,
});

const commentsTitled = (f: TestFactory, title: string) =>
  f.source.commentsOf("PROJ-1").filter((c) => c.body.split("\n")[0] === `${PREFIX} ${title}`);

describe("etapas grill → SPEC → Tickets", () => {
  it("o card recebe exatamente um comentário SPEC e um Tickets, com prefixo", async () => {
    const model = new FakeModel();
    model.respond = () =>
      deliverSpec({
        spec: "Botão que exporta o relatório em CSV.",
        tickets: [
          { titulo: "Endpoint de exportação", aceite: "GET /relatorio.csv responde 200 com o CSV" },
          { titulo: "Botão na tela", aceite: "Clicar baixa o arquivo" },
        ],
      });
    factory = await startTestFactory({ cards: [card()], model });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const [spec] = commentsTitled(factory, "SPEC");
    const [tickets] = commentsTitled(factory, "Tickets");
    expect(commentsTitled(factory, "SPEC")).toHaveLength(1);
    expect(commentsTitled(factory, "Tickets")).toHaveLength(1);
    expect(spec?.body).toContain("Botão que exporta o relatório em CSV.");
    expect(tickets?.body).toContain("- [ ] **1. Endpoint de exportação**: GET /relatorio.csv responde 200 com o CSV");
    expect(tickets?.body).toContain("- [ ] **2. Botão na tela**: Clicar baixa o arquivo");
  });

  it("nenhuma subtarefa é criada: o card continua sendo o único", async () => {
    factory = await startTestFactory({ cards: [card()] });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    expect(factory.source.cards.map((c) => c.key)).toEqual(["PROJ-1"]);
  });

  it("usa o modelo fixado na config para o papel de SPEC", async () => {
    factory = await startTestFactory({
      cards: [card()],
      config: { roles: { spec: { provider: FakeModel.PROVIDER, model: "spec-b" } } },
    });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    expect(factory.model.calls.map((c) => c.model)).toEqual(["spec-b"]);
  });

  it("o modelo recebe o card (campos, comentários, anexos de texto) e o conhecimento do projeto", async () => {
    factory = await startTestFactory({
      cards: [card({ description: "Hoje o relatório só sai em PDF." })],
      knowledge: "Neste projeto, todo endpoint novo exige teste de contrato.",
    });
    factory.source.humanComment("PROJ-1", "po", "O CSV deve usar ponto e vírgula.");
    factory.source.attach("PROJ-1", "colunas.txt", "data;valor;cliente");

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const [call] = factory.model.calls;
    expect(call?.context).toContain("Exportar relatório em CSV");
    expect(call?.context).toContain("Hoje o relatório só sai em PDF.");
    expect(call?.context).toContain("O CSV deve usar ponto e vírgula.");
    expect(call?.context).toContain("data;valor;cliente");
    expect(call?.context).toContain("Neste projeto, todo endpoint novo exige teste de contrato.");
  });

  it("rodar a etapa de novo edita os comentários existentes em vez de criar novos", async () => {
    const model = new FakeModel();
    model.respond = () => deliverSpec({ ...DEFAULT_SPEC, spec: `Versão ${model.calls.length}.` });
    factory = await startTestFactory({ cards: [card()], model });
    const source = factory.source;
    const addComment = source.addComment.bind(source);
    let failures = 1;
    // Publicar os Tickets falha uma vez: a tarefa é tentada de novo e roda a etapa outra vez, com outra SPEC.
    source.addComment = async (key, body) => {
      if (body.startsWith(`${PREFIX} Tickets`) && failures-- > 0) throw new Error("Jira fora do ar");
      return addComment(key, body);
    };

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    expect(model.calls).toHaveLength(2);
    expect(commentsTitled(factory, "SPEC")).toHaveLength(1);
    expect(commentsTitled(factory, "SPEC")[0]?.body).toContain("Versão 2.");
    expect(commentsTitled(factory, "Tickets")).toHaveLength(1);
  });

  it("retomar após reinício no meio da etapa não duplica os comentários nem chama o modelo de novo", async () => {
    factory = await startTestFactory({ cards: [card()] });
    const source = factory.source;
    const addComment = source.addComment.bind(source);
    let stuck = true;
    // O daemon "cai" ao escrever o comentário Tickets, depois de já ter escrito a SPEC.
    source.addComment = (key, body) =>
      stuck && body.startsWith(`${PREFIX} Tickets`) ? new Promise(() => {}) : addComment(key, body);

    await poll(factory);
    await eventually(() => expect(commentsTitled(factory as TestFactory, "SPEC")).toHaveLength(1));
    stuck = false;
    factory = await factory.restart();

    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(commentsTitled(factory, "SPEC")).toHaveLength(1);
    expect(commentsTitled(factory, "Tickets")).toHaveLength(1);
    expect(factory.model.calls).toHaveLength(1);
  });

  it("um comentário humano com o mesmo título não é editado: a fábrica escreve o próprio", async () => {
    factory = await startTestFactory({ cards: [card()] });
    const human = factory.source.humanComment("PROJ-1", "po", `${PREFIX} SPEC\n\nfeita à mão`);

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    expect(factory.source.commentsOf("PROJ-1").find((c) => c.id === human.id)?.body).toBe(
      `${PREFIX} SPEC\n\nfeita à mão`,
    );
    expect(commentsTitled(factory, "SPEC").filter((c) => c.author === USER)).toHaveLength(1);
  });

  it("se o modelo não entrega pela ferramenta, a tarefa tenta de novo sem publicar nada", async () => {
    const model = new FakeModel();
    let answers = 0;
    model.respond = () => (answers++ === 0 ? FakeModel.text("Não sei.") : deliverSpec(DEFAULT_SPEC));
    factory = await startTestFactory({ cards: [card()], model });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    expect((await events(factory)).some((e) => e.type === "error")).toBe(true);
    expect(commentsTitled(factory, "SPEC")).toHaveLength(1);
  });

  it("no dry-run o modelo roda, mas SPEC e Tickets só ficam registrados nos eventos", async () => {
    factory = await startTestFactory({ cards: [card()], dryRun: true });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    expect(factory.source.commentsOf("PROJ-1")).toEqual([]);
    const written = (await events(factory)).filter((e) => e.type === "write" && e.action === "comment");
    expect(written.map((e) => String(e.content).split("\n")[0])).toEqual([
      `${PREFIX} Assumindo este card.`,
      `${PREFIX} SPEC`,
      `${PREFIX} Tickets`,
    ]);
  });

  it("a tarefa fica ativa enquanto o modelo trabalha", async () => {
    const model = new FakeModel();
    const h = hold();
    model.respond = async () => {
      await h.promise;
      return deliverSpec(DEFAULT_SPEC);
    };
    factory = await startTestFactory({ cards: [card()], model });

    await poll(factory);
    await eventually(() => expect(model.calls).toHaveLength(1));
    expect(await statusOf(factory, "PROJ-1")).toBe("ativa");

    h.release();
    await waitForStatus(factory, "PROJ-1", "concluida");
  });
});
