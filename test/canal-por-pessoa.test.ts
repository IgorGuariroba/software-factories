import { afterEach, describe, expect, it } from "vitest";
import { avisoTeamsDe, canalDaPessoa } from "../src/packages/profiles/index.js";
import { askPo, DEFAULT_SPEC, deliverSpec, FakeModel, type ModelCall } from "./fakes/fake-model.js";
import { FakeTeamsConversa } from "./fakes/fake-teams-conversa.js";
import { api, eventually, poll, startTestFactory, statusOf, type TestFactory, USER, waitForStatus } from "./harness.js";

const USER_MRI = "8:orgid:fabrica";

// Fatia 08: cada pessoa recebe as perguntas por um canal. O comentário no card é o canal de perguntas e respostas; o
// canal "teams" acrescenta o aviso no Teams para a identidade dela. Sem canal escolhido, vale o padrão de antes.
describe("canal por pessoa do projeto", () => {
  it("sem canal escolhido, a pessoa segue pelo comentário no card", () => {
    expect(canalDaPessoa({ id: "a", identidades: { teams: "8:orgid:a" } })).toBe("card-comment");
  });

  it("o canal escolhido vale", () => {
    expect(canalDaPessoa({ id: "a", canal: "teams", identidades: { teams: "8:orgid:a" } })).toBe("teams");
    expect(canalDaPessoa({ id: "a", canal: "card-comment" })).toBe("card-comment");
  });

  it("aviso legado no Teams só para quem não escolheu canal e tem identidade; canal escolhido não avisa à parte", () => {
    expect(avisoTeamsDe({ id: "a", identidades: { teams: "8:orgid:a" } })).toBe("8:orgid:a");
    expect(avisoTeamsDe({ id: "a", canal: "card-comment", identidades: { teams: "8:orgid:a" } })).toBeUndefined();
    expect(avisoTeamsDe({ id: "a", canal: "teams", identidades: { teams: "8:orgid:a" } })).toBeUndefined();
  });

  describe("efeito no canal de perguntas e respostas", () => {
    const PO_MRI = "8:orgid:po";
    let f: TestFactory | undefined;
    afterEach(async () => {
      await f?.close();
      f = undefined;
    });

    async function perguntar(canal: "card-comment" | "teams" | undefined) {
      const avisos: { userId: string; text: string }[] = [];
      const conversa = new FakeTeamsConversa(USER_MRI);
      const model = new FakeModel();
      model.respond = (call: ModelCall) =>
        call.input.includes("# Card PROJ-1") && !call.input.includes("Resposta do PO")
          ? askPo("Qual o separador?")
          : deliverSpec(DEFAULT_SPEC);
      f = await startTestFactory({
        cards: [{ key: "PROJ-1", title: "Exportar", status: "A Fazer", assignee: USER }],
        model,
        teams: {
          send: async (message) => {
            avisos.push(message);
          },
        },
        teamsConversation: conversa,
        config: {
          source: { type: "jira", project: "PROJ", assignee: USER, baseUrl: "https://jira.example.invalid" },
          people: [{ id: "po-x", role: "po", identidades: { teams: PO_MRI }, ...(canal ? { canal } : {}) }],
        },
      });
      await poll(f);
      await waitForStatus(f, "PROJ-1", "aguardando-humano");
      return { avisos, conversa, card: f.source.commentsOf("PROJ-1").map((c) => c.body) };
    }

    it("canal card-comment: a pergunta vai ao card, sem aviso nem conversa no Teams", async () => {
      const { avisos, conversa, card } = await perguntar("card-comment");
      expect(avisos).toHaveLength(0);
      expect(conversa.enviadas).toHaveLength(0);
      expect(card.some((c) => c.includes("Qual o separador?"))).toBe(true);
    });

    it("canal teams: a pergunta vai pela conversa Teams da pessoa, e não é comentada no card", async () => {
      const { avisos, conversa, card } = await perguntar("teams");
      expect(avisos).toHaveLength(0);
      expect(conversa.enviadas).toEqual([{ userId: PO_MRI, text: expect.stringContaining("Qual o separador?") }]);
      expect(card.some((c) => c.includes("Qual o separador?"))).toBe(false);
    });

    it("canal teams: a resposta dada no Teams acorda a tarefa", async () => {
      const { conversa } = await perguntar("teams");
      conversa.reply(PO_MRI, PO_MRI, "Use ponto e vírgula.");
      await poll(f as TestFactory);
      await eventually(async () => expect(await statusOf(f as TestFactory, "PROJ-1")).not.toBe("aguardando-humano"));
    });

    it("canal teams sem identidade no Teams é recusado na configuração", async () => {
      f = await startTestFactory({});
      const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");
      const res = await fetch(`${f.url}/projetos/exemplo/configuracao`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...atual, people: [{ id: "po-x", role: "po", canal: "teams" }] }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("canal teams exige identidade no Teams");
    });
  });
});
