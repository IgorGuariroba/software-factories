import { createJiraDemandSource } from "../src/jira-demand-source.js";
import { describeDemandSourceContract } from "./demand-source.contract.js";
import { FakeAcli } from "./fakes/fake-acli.js";

// O adaptador Jira contra um `acli` falso nos formatos do Jira Cloud. O usuário está configurado pelo e-mail,
// enquanto o Jira devolve pessoas como objetos: a identidade normalizada tem de bater com o valor configurado.
describeDemandSourceContract("JiraDemandSource (acli falso)", () => {
  const me = { accountId: "acc-eu", emailAddress: "eu@exemplo.invalid", displayName: "Pessoa Eu" };
  const other = { accountId: "acc-outra", emailAddress: "outra@exemplo.invalid", displayName: "Outra Pessoa" };
  const acli = new FakeAcli(me);
  acli.issues = [
    { key: "PROJ-1", summary: "Primeiro card", status: "A Fazer", assignee: me },
    { key: "PROJ-2", summary: "Card de outra pessoa", status: "A Fazer", assignee: other },
    { key: "OUTROPROJ-1", summary: "Card de outro projeto", status: "A Fazer", assignee: me },
  ];
  acli.addHumanComment("PROJ-1", other, "Comentário de uma pessoa");
  return {
    source: createJiraDemandSource({ project: "PROJ", assignee: me.emailAddress, runner: acli.runner }),
    project: "PROJ",
    assignee: me.emailAddress,
    existingCardKey: "PROJ-1",
    transition: { fromStatus: "A Fazer", toStatus: "Em Andamento" },
  };
});
