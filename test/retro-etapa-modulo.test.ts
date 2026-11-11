import { describe, expect, it, vi } from "vitest";
import {
  concluirRetro,
  type EtapaRetro,
  type PortasRetro,
  type TarefaRetro,
} from "../src/packages/retro-etapa/index.js";

// Retrô de uma etapa com portas falsas: fixa quando a retrô roda (a etapa precisa ter o que revisar), a pausa com
// aprovação (uma vez por etapa, com aviso) e a retrô consolidada, que nunca pausa a Tarefa.

const alvo = { id: "p/K-1", projeto: "p", chave: "K-1" };

function portasFalsas(tarefa: TarefaRetro | undefined, pausaInicial = true) {
  const executadas: EtapaRetro[] = [];
  const avisos: EtapaRetro[] = [];
  const portas: PortasRetro = {
    tarefa: async () => tarefa,
    executar: vi.fn(async (_id, etapa) => {
      executadas.push(etapa);
    }),
    pausarParaRevisao: vi.fn(async () => pausaInicial),
    avisarPronta: async (_projeto, _chave, etapa) => {
      avisos.push(etapa);
    },
  };
  return { portas, executadas, avisos };
}

describe("Retrô: quando roda", () => {
  it("sem tarefa, nada roda", async () => {
    const { portas, executadas } = portasFalsas(undefined);
    await concluirRetro(portas, alvo, "spec", false);
    expect(executadas).toEqual([]);
  });

  it("implementação que não rodou não tem retrô", async () => {
    const { portas, executadas } = portasFalsas({ implementation: null });
    await concluirRetro(portas, alvo, "implementacao", false);
    expect(executadas).toEqual([]);
  });

  it("triagem, revisão e MR só rodam com o registro da etapa", async () => {
    const { portas, executadas } = portasFalsas({ triage: null, review: null, publication: null });
    for (const etapa of ["triagem", "review", "mr"] as const) await concluirRetro(portas, alvo, etapa, false);
    expect(executadas).toEqual([]);
    const completa = portasFalsas({ triage: {}, review: {}, publication: {}, implementation: {} });
    for (const etapa of ["triagem", "review", "mr", "implementacao"] as const)
      await concluirRetro(completa.portas, alvo, etapa, false);
    expect(completa.executadas).toEqual(["triagem", "review", "mr", "implementacao"]);
  });

  it("spec e a consolidada rodam sem depender de registro", async () => {
    const { portas, executadas } = portasFalsas({});
    await concluirRetro(portas, alvo, "spec", false);
    await concluirRetro(portas, alvo, "tarefa", false);
    expect(executadas).toEqual(["spec", "tarefa"]);
  });
});

describe("Retrô: pausa para revisão", () => {
  it("sem aprovação de retrô, roda e não pausa", async () => {
    const { portas, avisos } = portasFalsas({});
    await concluirRetro(portas, alvo, "spec", false);
    expect(portas.pausarParaRevisao).not.toHaveBeenCalled();
    expect(avisos).toEqual([]);
  });

  it("com aprovação, pausa a Tarefa antes da próxima etapa e avisa", async () => {
    const { portas, avisos } = portasFalsas({});
    await concluirRetro(portas, alvo, "spec", true);
    expect(portas.pausarParaRevisao).toHaveBeenCalledWith("p/K-1", "spec");
    expect(avisos).toEqual(["spec"]);
  });

  it("já pausada para esta etapa não avisa de novo", async () => {
    const { portas, avisos } = portasFalsas({}, false);
    await concluirRetro(portas, alvo, "spec", true);
    expect(avisos).toEqual([]);
  });

  it("a consolidada nunca pausa a Tarefa, mesmo com aprovação", async () => {
    const { portas, executadas } = portasFalsas({});
    await concluirRetro(portas, alvo, "tarefa", true);
    expect(executadas).toEqual(["tarefa"]);
    expect(portas.pausarParaRevisao).not.toHaveBeenCalled();
  });
});
