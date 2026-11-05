import type { AcliRunner } from "../src/jira-demand-source.js";
import { createJiraDemandSource } from "../src/jira-demand-source.js";
import { describeDemandSourceContract } from "./demand-source.contract.js";
import { FakeAcli } from "./fakes/fake-acli.js";

const text = (t: string) => ({ type: "text", text: t });
const paragraph = (...content: object[]) => ({ type: "paragraph", content });

/** Descrição como o Jira Cloud a guarda (ADF): linha em branco, lista, régua e citação. */
const RICH_DESCRIPTION = {
  type: "doc",
  version: 1,
  content: [
    paragraph(text("Título")),
    { type: "paragraph" },
    paragraph(text("Introdução")),
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [paragraph(text("Primeiro"))] },
        { type: "listItem", content: [text("Segundo")] },
      ],
    },
    { type: "rule" },
    { type: "blockquote", content: [paragraph(text("Nota"))] },
    paragraph(text("Fim")),
  ],
};

/** Comentário com menção e quebra de linha, em ADF. */
const RICH_COMMENT = {
  type: "doc",
  version: 1,
  content: [
    paragraph(
      text("Olá "),
      { type: "mention", attrs: { id: "acc-outra", text: "@Outra Pessoa" } },
      { type: "hardBreak" },
      text("segunda linha"),
    ),
  ],
};

// O adaptador Jira contra um `acli` falso nos formatos do Jira Cloud. O usuário está configurado pelo e-mail,
// enquanto o Jira devolve pessoas como objetos: a identidade normalizada tem de bater com o valor configurado.
describeDemandSourceContract("JiraDemandSource (acli falso)", () => {
  const me = { accountId: "acc-eu", emailAddress: "eu@exemplo.invalid", displayName: "Pessoa Eu" };
  const other = { accountId: "acc-outra", emailAddress: "outra@exemplo.invalid", displayName: "Outra Pessoa" };
  const acli = new FakeAcli(me);
  // Mais cards do que cabem numa página da busca do Jira (50).
  const many = Array.from({ length: 60 }, (_, i) => ({
    key: `PROJ-${100 + i}`,
    summary: `Card ${100 + i}`,
    status: "A Fazer",
    assignee: me,
  }));
  acli.issues = [
    {
      key: "PROJ-1",
      summary: "Primeiro card",
      status: "A Fazer",
      assignee: me,
      description: RICH_DESCRIPTION,
      attachments: [
        {
          id: "1",
          filename: "especificacao.md",
          mimeType: "text/markdown",
          size: 1,
          content: "https://exemplo.invalid/a/1",
        },
        { id: "2", filename: "print.png", mimeType: "image/png", size: 1, content: "https://exemplo.invalid/a/2" },
        { id: "3", filename: "dados.csv", mimeType: "text/csv", size: 1, content: "https://exemplo.invalid/a/3" },
      ],
    },
    { key: "PROJ-2", summary: "Card de outra pessoa", status: "A Fazer", assignee: other },
    { key: "OUTROPROJ-1", summary: "Card de outro projeto", status: "A Fazer", assignee: me },
    ...many,
  ];
  acli.addHumanComment("PROJ-1", other, "Comentário de uma pessoa");
  acli.addHumanComment("PROJ-1", other, RICH_COMMENT);

  const options = { project: "PROJ", assignee: me.emailAddress, env: {} };
  const runnerPrinting =
    (stdout: string, exitCode = 0): AcliRunner =>
    async () => ({ stdout: exitCode === 0 ? stdout : "", stderr: exitCode === 0 ? "" : stdout, exitCode });
  // Sem ATLASSIAN_EMAIL/ATLASSIAN_API_TOKEN: o conteúdo dos anexos de texto chega com o aviso explícito.
  const unread = "[conteúdo não lido: defina ATLASSIAN_EMAIL e ATLASSIAN_API_TOKEN]";
  return {
    source: createJiraDemandSource({ ...options, runner: acli.runner }),
    project: "PROJ",
    assignee: me.emailAddress,
    existingCardKey: "PROJ-1",
    transition: { fromStatus: "A Fazer", toStatus: "Em Andamento" },
    assignedKeys: ["PROJ-1", ...many.map((i) => i.key)],
    richText: {
      key: "PROJ-1",
      description: "Título\n\nIntrodução\nPrimeiro\nSegundo\n\nNota\nFim",
      comment: "Olá @Outra Pessoa\nsegunda linha",
    },
    attachments: {
      key: "PROJ-1",
      expected: [
        { name: "especificacao.md", content: unread },
        { name: "dados.csv", content: unread },
      ],
    },
    failing: [
      {
        name: "acli saindo com erro",
        source: createJiraDemandSource({ ...options, runner: runnerPrinting("timeout", 1) }),
      },
      {
        name: "acli devolvendo JSON inválido",
        source: createJiraDemandSource({ ...options, runner: runnerPrinting("<html>") }),
      },
    ],
  };
});
