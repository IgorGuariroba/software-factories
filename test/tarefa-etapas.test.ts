import { describe, expect, it, vi } from "vitest";
import {
  ciclarRevisao,
  executarEntrega,
  type FeedbackPublicacao,
  type PortasEtapa,
  retomarCorrecoes,
  type TarefaEtapa,
} from "../src/packages/tarefa/index.js";

// Orquestração de revisão e entrega com portas falsas: fixa a retomada de correções pendentes, o ciclo de revisão,
// os lotes de entrega, o feedback levado em conta, o bloqueio que vira progresso e o limite de lotes. Sem fábrica.

class Bloqueio extends Error {}

function tarefaCom(extra: Partial<TarefaEtapa> = {}): TarefaEtapa {
  return { implementation: null, delivery: null, correctionTickets: null, review: null, publication: null, ...extra };
}

function portasFalsas(tarefa: TarefaEtapa, sobrescritas: Partial<PortasEtapa> = {}) {
  const progressos: { mensagem: string; historico: boolean }[] = [];
  const portas: PortasEtapa = {
    estado: async () => tarefa,
    alterar: async (fn) => fn(tarefa),
    progresso: async (mensagem, historico = false) => {
      progressos.push({ mensagem, historico });
    },
    implementar: vi.fn(async () => undefined),
    sincronizarBase: vi.fn(async () => false),
    revisar: vi.fn(async () => "aprovado"),
    emEnsaio: () => false,
    requisicaoDaTarefa: async () => undefined,
    consultarRequisicao: async () => undefined,
    entregar: vi.fn(async () => "acompanhar" as const),
    mensagemDeBloqueio: (erro) => (erro instanceof Bloqueio ? erro.message : undefined),
    redigir: (texto) => texto.replace(/token-\w+/g, "[redigido]"),
    ...sobrescritas,
  };
  return { portas, progressos };
}

describe("Tarefa: retomada de correções", () => {
  it("retoma quando há correção sem commit de implementação", async () => {
    // O ticket 0 é o original; a correção (índice 0) é o ticket 1, ainda sem commit.
    const tarefa = tarefaCom({
      implementation: { commits: [{ phase: "implementacao", ticket: 0 }] },
      delivery: { tickets: [{}] },
      correctionTickets: [{}],
    });
    const { portas } = portasFalsas(tarefa);
    expect(await retomarCorrecoes(portas)).toBe(true);
    expect(portas.implementar).toHaveBeenCalledTimes(1);
  });

  it("não retoma quando todas as correções já têm commit", async () => {
    const tarefa = tarefaCom({
      implementation: {
        commits: [{ phase: "implementacao", ticket: 1 }],
        verifiedTickets: [{ ticket: 2 }],
      },
      delivery: { tickets: [{}] },
      correctionTickets: [{}],
    });
    const { portas } = portasFalsas(tarefa);
    expect(await retomarCorrecoes(portas)).toBe(false);
    expect(portas.implementar).not.toHaveBeenCalled();
  });
});

describe("Tarefa: ciclo de revisão", () => {
  it("corrige enquanto a revisão pede correção, registra o veredito e para no aprovado", async () => {
    const tarefa = tarefaCom({ review: { head: "abcdef123456", summary: "ok" } });
    const vereditos = ["corrigir", "aprovado"];
    const { portas, progressos } = portasFalsas(tarefa, {
      revisar: vi.fn(async () => vereditos.shift()),
    });
    await ciclarRevisao(portas);
    expect(portas.implementar).toHaveBeenCalledTimes(1);
    expect(portas.revisar).toHaveBeenCalledTimes(2);
    // Cada veredito é registrado, inclusive o que pede correção.
    expect(progressos).toEqual([
      { mensagem: "Review corrigir do HEAD abcdef12: ok", historico: true },
      { mensagem: "Review aprovado do HEAD abcdef12: ok", historico: true },
    ]);
  });

  it("sem veredito, não registra progresso", async () => {
    const { portas, progressos } = portasFalsas(tarefaCom(), { revisar: async () => undefined });
    await ciclarRevisao(portas);
    expect(progressos).toEqual([]);
  });
});

describe("Tarefa: entrega", () => {
  it("publicação pronta: registra o estado da PR/MR e devolve acompanhar", async () => {
    const tarefa = tarefaCom({ publication: { status: "aberta", url: "https://git/pr/9", feedbackIds: [] } });
    const { portas, progressos } = portasFalsas(tarefa);
    expect(await executarEntrega(portas)).toBe("acompanhar");
    expect(progressos).toEqual([{ mensagem: "PR/MR aberta: https://git/pr/9", historico: false }]);
  });

  it("PR/MR fechada não sincroniza nem revisa antes de entregar", async () => {
    const { portas } = portasFalsas(tarefaCom(), {
      requisicaoDaTarefa: async () => ({ worktree: "/wt", numero: 9 }),
      consultarRequisicao: async () => "closed",
    });
    await executarEntrega(portas);
    expect(portas.sincronizarBase).not.toHaveBeenCalled();
    expect(portas.revisar).not.toHaveBeenCalled();
    expect(portas.entregar).toHaveBeenCalledTimes(1);
  });

  it("bloqueio na entrega vira progresso redigido e segue como erro", async () => {
    const { portas, progressos } = portasFalsas(tarefaCom(), {
      entregar: async () => {
        throw new Bloqueio("CI reprovada com token-xyz");
      },
    });
    await expect(executarEntrega(portas)).rejects.toThrow("CI reprovada");
    expect(progressos).toEqual([{ mensagem: "Entrega bloqueada: CI reprovada com [redigido]", historico: false }]);
  });

  it("erro que não é bloqueio só registra o estado da publicação", async () => {
    const tarefa = tarefaCom({ publication: { status: "rascunho", feedbackIds: [] } });
    const { portas, progressos } = portasFalsas(tarefa, {
      entregar: async () => {
        throw new Error("rede caiu");
      },
    });
    await expect(executarEntrega(portas)).rejects.toThrow("rede caiu");
    expect(progressos).toEqual([{ mensagem: "PR/MR rascunho", historico: false }]);
  });

  it("pedido de revisão leva o feedback à revisão, marca como levado em conta e entrega de novo", async () => {
    const feedback: FeedbackPublicacao[] = [{ id: "c1", body: "troque o nome", author: "ana" }];
    const tarefa = tarefaCom({
      publication: { status: "aberta", feedbackIds: ["c0"], pendingFeedback: feedback },
    });
    const entregas = ["revisar", "acompanhar"] as const;
    let i = 0;
    const { portas } = portasFalsas(tarefa, {
      entregar: vi.fn(async () => entregas[i++]),
    });
    expect(await executarEntrega(portas)).toBe("acompanhar");
    expect(portas.revisar).toHaveBeenCalledWith(feedback);
    expect(tarefa.publication).toEqual({
      status: "aberta",
      feedbackIds: ["c0", "c1"],
      pendingFeedback: [],
    });
    expect(portas.entregar).toHaveBeenCalledTimes(2);
  });

  it("no máximo três lotes: se a entrega pedir revisão sempre, devolve acompanhar", async () => {
    const tarefa = tarefaCom({ publication: { status: "aberta", feedbackIds: [], pendingFeedback: [] } });
    const { portas } = portasFalsas(tarefa, { entregar: vi.fn(async () => "revisar" as const) });
    expect(await executarEntrega(portas)).toBe("acompanhar");
    expect(portas.entregar).toHaveBeenCalledTimes(3);
  });
});

describe("Tarefa: consulta remota da PR/MR", () => {
  it("em ensaio não consulta o remoto", async () => {
    const consultar = vi.fn(async () => "closed");
    const { portas } = portasFalsas(tarefaCom(), {
      emEnsaio: () => true,
      requisicaoDaTarefa: async () => ({ worktree: "/wt", numero: 9 }),
      consultarRequisicao: consultar,
    });
    await executarEntrega(portas);
    expect(consultar).not.toHaveBeenCalled();
  });

  it("sem PR/MR ou sem implementação não consulta", async () => {
    const consultar = vi.fn(async () => "open");
    const semNumero = portasFalsas(tarefaCom(), {
      requisicaoDaTarefa: async () => ({ worktree: "/wt" }),
      consultarRequisicao: consultar,
    });
    await executarEntrega(semNumero.portas);
    const semWorktree = portasFalsas(tarefaCom(), {
      requisicaoDaTarefa: async () => ({ numero: 9 }),
      consultarRequisicao: consultar,
    });
    await executarEntrega(semWorktree.portas);
    expect(consultar).not.toHaveBeenCalled();
  });
});
