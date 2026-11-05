import { describeDemandSourceContract } from "./demand-source.contract.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";

describeDemandSourceContract("MemoryDemandSource (fake)", () => {
  const project = "PROJ";
  const assignee = "igor";
  const existingCardKey = "PROJ-1";

  // Mais cards do que caberiam numa página de uma Fonte real.
  const many = Array.from({ length: 60 }, (_, i) => ({
    key: `PROJ-${100 + i}`,
    title: `Card ${100 + i}`,
    status: "A Fazer",
    assignee: "igor",
  }));
  const richDescription = "Título\n\nIntrodução\nPrimeiro\nSegundo\n\nNota\nFim";
  const richComment = "Olá @Outra Pessoa\nsegunda linha";
  const source = new MemoryDemandSource(
    [
      {
        key: "PROJ-1",
        title: "Primeiro card",
        status: "A Fazer",
        assignee: "igor",
        description: richDescription,
      },
      {
        key: "PROJ-2",
        title: "Card de outra pessoa",
        status: "A Fazer",
        assignee: "outro-dev",
      },
      {
        key: "OUTROPROJ-1",
        title: "Card de outro projeto",
        status: "A Fazer",
        assignee: "igor",
      },
      ...many,
    ],
    "igor",
    project,
  );

  source.attach(existingCardKey, "requisitos.txt", "requisitos em texto");
  source.attach(existingCardKey, "evidencia.png", "conteudo binario simulado");
  source.humanComment(existingCardKey, "outro-dev", richComment);
  const down = new MemoryDemandSource(source.cards, "igor", project);
  down.unavailable = new Error("Fonte fora do ar");

  return {
    source,
    project,
    assignee,
    existingCardKey,
    transition: {
      fromStatus: "A Fazer",
      toStatus: "Em Andamento",
    },
    assignedKeys: ["PROJ-1", ...many.map((c) => c.key)],
    richText: { key: existingCardKey, description: richDescription, comment: richComment },
    attachments: { key: existingCardKey, expected: [{ name: "requisitos.txt", content: "requisitos em texto" }] },
    failing: [{ name: "a Fonte fora do ar", source: down }],
  };
});
