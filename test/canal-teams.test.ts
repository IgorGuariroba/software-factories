import { describe, expect, it } from "vitest";
import { createTeamsChannel } from "../src/teams-canal.js";
import { FakeTeamsConversa } from "./fakes/fake-teams-conversa.js";

const PO_MRI = "8:orgid:maria";
const ME = "8:orgid:fabrica";

// Fatia 08 / 01: o canal Teams é de conversa: a pergunta vai pela conversa da pessoa, e a resposta é lida dela.
describe("canal Teams de conversa", () => {
  it("envia a pergunta à conversa da pessoa e a devolve como referência da pergunta", async () => {
    const conversa = new FakeTeamsConversa(ME);
    const canal = createTeamsChannel({ conversation: conversa, personMri: PO_MRI });

    const ref = await canal.ask({ card: "PROJ-1", to: "maria", text: "Pergunta 1: qual o separador?" });

    expect(conversa.enviadas).toEqual([{ userId: PO_MRI, text: expect.stringContaining("qual o separador?") }]);
    expect(ref).toMatchObject({ card: "PROJ-1", to: "maria" });
    expect(ref.conversa?.conversationId).toBe(`conv-${PO_MRI}`);
  });

  it("sem resposta, não há resposta; com a resposta da pessoa, devolve o texto dela", async () => {
    const conversa = new FakeTeamsConversa(ME);
    const canal = createTeamsChannel({ conversation: conversa, personMri: PO_MRI });
    const ref = await canal.ask({ card: "PROJ-1", to: "maria", text: "Pergunta 1: qual o separador?" });

    expect(await canal.answer(ref)).toBeUndefined();

    conversa.reply(PO_MRI, PO_MRI, "Use ponto e vírgula.");
    expect(await canal.answer(ref)).toBe("Use ponto e vírgula.");
  });

  it("ignora mensagens da fábrica e de outras pessoas", async () => {
    const conversa = new FakeTeamsConversa(ME);
    const canal = createTeamsChannel({ conversation: conversa, personMri: PO_MRI });
    const ref = await canal.ask({ card: "PROJ-1", to: "maria", text: "Pergunta 1: x" });

    conversa.reply(PO_MRI, "8:orgid:outra-pessoa", "eu respondo no lugar dela");
    expect(await canal.answer(ref)).toBeUndefined();
  });

  it("o lembrete vai para a mesma conversa da pergunta", async () => {
    const conversa = new FakeTeamsConversa(ME);
    const canal = createTeamsChannel({ conversation: conversa, personMri: PO_MRI });
    const ref = await canal.ask({ card: "PROJ-1", to: "maria", text: "Pergunta 1: x" });

    await canal.remind(ref, "Lembrete da pergunta 1");

    expect(conversa.enviadas.map((e) => e.userId)).toEqual([PO_MRI, PO_MRI]);
    expect(conversa.enviadas[1]?.text).toContain("Lembrete da pergunta 1");
  });

  it("em ensaio (dry-run) não envia nada ao Teams", async () => {
    const conversa = new FakeTeamsConversa(ME);
    const canal = createTeamsChannel({ conversation: conversa, personMri: PO_MRI, dryRun: true });

    await canal.ask({ card: "PROJ-1", to: "maria", text: "Pergunta 1: x" });

    expect(conversa.enviadas).toEqual([]);
  });
});
