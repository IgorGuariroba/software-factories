import { afterEach, describe, expect, it } from "vitest";
import { askPo, DEFAULT_SPEC, deliverSpec, FakeModel, type ModelCall } from "./fakes/fake-model.js";
import { FakeTelegram } from "./fakes/fake-telegram.js";
import { poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

// Fatia 09: o Telegram é interface de gestão do usuário. Ele nunca fala com as pessoas do projeto.
const PO = "po-projeto-xyz";

describe("Telegram (interface de gestão) não envia mensagem a pessoas do projeto", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("numa pergunta ao PO, o Telegram avisa o usuário, mas nenhuma mensagem dele leva a pessoa do projeto", async () => {
    const telegram = new FakeTelegram();
    const model = new FakeModel();
    model.respond = (call: ModelCall) =>
      call.input.includes("# Card PROJ-1") && !call.input.includes("Resposta do PO")
        ? askPo("Qual o separador do CSV?")
        : deliverSpec(DEFAULT_SPEC);
    f = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "Exportar", status: "A Fazer", assignee: USER }],
      model,
      telegram,
      config: {
        source: { type: "jira", project: "PROJ", assignee: USER, baseUrl: "https://jira.example.invalid" },
        people: [{ id: PO, role: "po" }],
      },
    });
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-humano");

    expect(telegram.sent.length).toBeGreaterThan(0);
    for (const mensagem of telegram.sent) {
      expect(mensagem.text).not.toContain(PO);
      expect(mensagem.text).not.toContain("[~accountid:");
    }
  });
});
