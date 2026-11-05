import { describeDemandSourceContract } from "./demand-source.contract.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";

describeDemandSourceContract("MemoryDemandSource (fake)", () => {
  const project = "PROJ";
  const assignee = "igor";
  const existingCardKey = "PROJ-1";

  const source = new MemoryDemandSource(
    [
      {
        key: "PROJ-1",
        title: "Primeiro card",
        status: "A Fazer",
        assignee: "igor",
        description: "Descrição detalhada do card",
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
    ],
    "igor",
    project,
  );

  source.attach(existingCardKey, "requisitos.txt", "requisitos em texto");
  source.attach(existingCardKey, "evidencia.png", "conteudo binario simulado");

  return {
    source,
    project,
    assignee,
    existingCardKey,
    transition: {
      fromStatus: "A Fazer",
      toStatus: "Em Andamento",
    },
  };
});
