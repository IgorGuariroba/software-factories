import { afterEach, describe, expect, it } from "vitest";
import { askPo, DEFAULT_SPEC, deliverSpec, FakeModel, type ModelCall } from "./fakes/fake-model.js";
import { poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

// Decisão do usuário: o comentário que faz uma pergunta no card leva a menção à pessoa (ADR-0020).
describe("comentário no card menciona a pessoa perguntada", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("a pergunta ao PO no card contém a menção ao identificador dele na Fonte", async () => {
    const PO = "po-mencionado";
    const model = new FakeModel();
    model.respond = (call: ModelCall) =>
      call.input.includes("# Card PROJ-1") && !call.input.includes("Resposta do PO")
        ? askPo("Qual o separador?")
        : deliverSpec(DEFAULT_SPEC);
    f = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "Exportar", status: "A Fazer", assignee: USER }],
      model,
      config: { people: [{ id: PO, role: "po" }] },
    });
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-humano");

    const pergunta = f.source.commentsOf("PROJ-1").find((c) => c.body.includes("Qual o separador?"));
    expect(pergunta?.body).toContain(f.source.formatMention(PO));
  });
});
