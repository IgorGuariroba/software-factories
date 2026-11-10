import { describe, expect, it } from "vitest";
import { createJiraDemandSource } from "../src/jira-demand-source.js";
import { FakeAcli, type FakeJiraPerson } from "./fakes/fake-acli.js";

const me: FakeJiraPerson = { accountId: "acc-eu", emailAddress: "eu@exemplo.invalid", displayName: "Pessoa Eu" };

// Verificado no tenant de teste (SANDBOX-2): o acli grava texto puro como texto, e só ADF com nó `mention` vira menção.
describe("Fonte Jira sem REST: o acli recebe ADF, para a menção funcionar", () => {
  it("sem credenciais REST, o comentário vai ao acli em ADF com nó de menção", async () => {
    const acli = new FakeAcli(me);
    acli.issues = [{ key: "PROJ-1", summary: "x", status: "A Fazer", assignee: me }];
    const source = createJiraDemandSource({ project: "PROJ", assignee: me.accountId, runner: acli.runner, env: {} });

    await source.addComment("PROJ-1", "[~accountid:po-1] Pergunta 1: qual o separador?");

    const chamada = acli.calls.find((args) => args.includes("create"));
    const corpo = chamada?.[chamada.indexOf("--body") + 1] ?? "";
    const adf = JSON.parse(corpo) as { content: { content: unknown[] }[] };
    expect(adf.content[0]?.content).toContainEqual(expect.objectContaining({ type: "mention", attrs: { id: "po-1" } }));
    expect(corpo).not.toContain("[~accountid:po-1]");
  });
});
