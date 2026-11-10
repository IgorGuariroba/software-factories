import { afterEach, describe, expect, it } from "vitest";
import { askPo, DEFAULT_SPEC, deliverSpec, FakeModel, type ModelCall } from "./fakes/fake-model.js";
import { FakeTeamsConversa } from "./fakes/fake-teams-conversa.js";
import { poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

// Critério do ticket 07: pessoa do perfil PO sem identificador no canal de conversa segue pelo comentário no card.
describe("pessoa sem identificador no canal", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("sem identificador no Teams, a pergunta vai ao card e a conversa Teams fica intocada", async () => {
    const conversa = new FakeTeamsConversa("8:orgid:fabrica");
    const model = new FakeModel();
    model.respond = (call: ModelCall) =>
      call.input.includes("# Card PROJ-1") && !call.input.includes("Resposta do PO")
        ? askPo("Qual o separador?")
        : deliverSpec(DEFAULT_SPEC);
    f = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "Exportar", status: "A Fazer", assignee: USER }],
      model,
      teamsConversation: conversa,
      config: { people: [{ id: "po-sem-teams", role: "po" }] },
    });
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-humano");

    expect(conversa.enviadas).toEqual([]);
    expect(f.source.commentsOf("PROJ-1").some((c) => c.body.includes("Qual o separador?"))).toBe(true);
  });
});
