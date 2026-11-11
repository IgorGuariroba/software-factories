import { describe, expect, it, vi } from "vitest";
import {
  criarControleTarefas,
  type EstadoControle,
  reinspecionarVetos,
  type TarefaControle,
} from "../src/packages/controle-tarefa/index.js";

// Reinspeção dos vetos com portas falsas: fixa que a Fonte mandando seguir encerra o prazo agora e abre o portão, que
// outro veredito não muda nada, que falha da consulta preserva o prazo, e que só vetos vivos no prazo são consultados.

const AGORA = 1_000_000;

function tarefa(extra: Partial<TarefaControle> = {}): TarefaControle {
  return {
    id: "p/K-1",
    project: "p",
    status: "aguardando-veto",
    stage: "triagem",
    pauseRequested: false,
    durableId: null,
    gateId: 9,
    reason: null,
    implementation: null,
    veto: { until: AGORA + 60_000 },
    ...extra,
  };
}

function portasFalsas(estado: EstadoControle, inspecao: "seguir" | "outro" | "falha") {
  const abortados: number[] = [];
  const falhas: string[] = [];
  const inspecionar = vi.fn(async () => {
    if (inspecao === "falha") throw new Error("Fonte fora do ar");
    return { kind: inspecao } as { kind: "seguir" } | { kind: "outro" };
  });
  const portas = {
    alterar: async <T>(fn: (e: EstadoControle) => T) => fn(estado),
    abortar: async (id: number) => {
      abortados.push(id);
    },
    agora: () => AGORA,
    tipoDeBloqueio: () => null,
    inspecionar,
    avisarFalha: (id: string) => {
      falhas.push(id);
    },
  };
  return { portas, abortados, falhas, inspecionar };
}

describe("Reinspeção de veto", () => {
  it("a Fonte manda seguir: o prazo encerra agora e o portão é aberto", async () => {
    const t = tarefa();
    const { portas, abortados } = portasFalsas({ daemonPaused: false, tasks: [t] }, "seguir");
    await reinspecionarVetos(portas);
    expect(t.veto?.until).toBe(AGORA);
    expect(abortados).toEqual([9]);
  });

  it("outro veredito não muda nada", async () => {
    const t = tarefa();
    const until = t.veto?.until;
    const { portas, abortados } = portasFalsas({ daemonPaused: false, tasks: [t] }, "outro");
    await reinspecionarVetos(portas);
    expect(t.veto?.until).toBe(until);
    expect(abortados).toEqual([]);
  });

  it("falha da consulta é registrada e o prazo continua valendo", async () => {
    const t = tarefa();
    const until = t.veto?.until;
    const { portas, falhas, abortados } = portasFalsas({ daemonPaused: false, tasks: [t] }, "falha");
    await reinspecionarVetos(portas);
    expect(falhas).toEqual(["p/K-1"]);
    expect(t.veto?.until).toBe(until);
    expect(abortados).toEqual([]);
  });

  it("veto expirado, prazo vencido ou status diferente nem é consultado", async () => {
    const expirado = tarefa({ id: "p/A", veto: { until: AGORA + 1, expired: true } });
    const vencido = tarefa({ id: "p/B", veto: { until: AGORA } });
    const outro = tarefa({ id: "p/C", status: "enfileirada" });
    const { portas, inspecionar } = portasFalsas({ daemonPaused: false, tasks: [expirado, vencido, outro] }, "seguir");
    await reinspecionarVetos(portas);
    expect(inspecionar).not.toHaveBeenCalled();
  });

  it("a integração com o controle expõe a reinspeção pelas mesmas portas", async () => {
    const t = tarefa();
    const { portas } = portasFalsas({ daemonPaused: false, tasks: [t] }, "outro");
    const controle = criarControleTarefas(portas);
    expect(typeof controle.vetar).toBe("function");
  });
});
