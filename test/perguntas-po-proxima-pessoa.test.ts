import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "./fakes/fake-clock.js";
import { askPo, DEFAULT_SPEC, deliverSpec, FakeModel, type ModelCall } from "./fakes/fake-model.js";
import { api, eventually, PO, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

// Fatia 07: a pergunta de negócio vai à primeira pessoa do perfil PO; sem resposta no prazo, escalona à seguinte.
const PO2 = "po-segundo";
const CALENDAR = {
  timezone: "America/Sao_Paulo",
  workdays: ["mon", "tue", "wed", "thu", "fri"] as ("mon" | "tue" | "wed" | "thu" | "fri")[],
  start: "09:00",
  end: "18:00",
  holidays: [] as string[],
};

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

describe("escalonamento de pergunta de negócio à próxima pessoa do perfil PO", () => {
  it("sem resposta no prazo de um dia útil, a pergunta vai à segunda pessoa do perfil PO, na ordem da lista", async () => {
    const clock = new FakeClock("2026-11-09T09:00:00-03:00");
    const model = new FakeModel();
    model.respond = (call: ModelCall) =>
      call.input.includes("# Card PROJ-1") && !call.input.includes("Resposta do PO")
        ? askPo("Qual o separador do CSV?")
        : deliverSpec(DEFAULT_SPEC);
    factory = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "Exportar", status: "A Fazer", assignee: USER }],
      model,
      clock,
      config: {
        calendar: CALENDAR,
        people: [
          { id: PO, role: "po" },
          { id: PO2, role: "po" },
        ],
      },
    });
    const f = factory;
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-humano");

    // Um dia útil de 9 h a partir de segunda 09:00 termina no fim do expediente; o aviso sai na abertura da terça.
    clock.advanceTo("2026-11-10T09:00:00-03:00");

    await eventually(() => {
      const perguntadoSegundo = f.source
        .commentsOf("PROJ-1")
        .some((c) => c.author === USER && c.body.includes(`encaminhada a ${PO2}`));
      expect(perguntadoSegundo).toBe(true);
    });
  });

  it("com revisão de perguntas, depois de aprovada, a pergunta sem resposta vira rascunho para a pessoa seguinte", async () => {
    const clock = new FakeClock("2026-11-09T09:00:00-03:00");
    const model = new FakeModel();
    model.respond = (call: ModelCall) =>
      call.input.includes("# Card PROJ-1") && !call.input.includes("Resposta do PO")
        ? askPo("Qual o separador do CSV?")
        : deliverSpec(DEFAULT_SPEC);
    factory = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "Exportar", status: "A Fazer", assignee: USER }],
      model,
      clock,
      config: {
        calendar: CALENDAR,
        questionApproval: true,
        people: [
          { id: PO, role: "po" },
          { id: PO2, role: "po" },
        ],
      },
    });
    const f = factory;
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-humano");
    // Com revisão, a primeira pergunta só sai depois de aprovada: o escalonamento só existe depois dela.
    const previa = await api<{ revision: string }>(f, "GET", "/tasks/exemplo/PROJ-1/questions/1");
    await api(f, "POST", "/tasks/exemplo/PROJ-1/questions/1/approve", { revision: previa.revision });

    clock.advanceTo("2026-11-10T09:00:00-03:00");

    await eventually(async () => {
      const detalhe = await api<{ questions: { n: number; to: string; publication?: string }[] }>(
        f,
        "GET",
        "/tasks/exemplo/PROJ-1",
      );
      expect(detalhe.questions[0]).toMatchObject({ n: 1, to: PO2, publication: "draft" });
    });
  });
});
