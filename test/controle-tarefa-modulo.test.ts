import { describe, expect, it, vi } from "vitest";
import {
  criarControleTarefas,
  type EstadoControle,
  type PortasControle,
  type TarefaControle,
  type TipoDeBloqueio,
} from "../src/packages/controle-tarefa/index.js";

// Controle de Tarefas com portas falsas: fixa a pausa por estado, o que a retomada destrava por tipo de bloqueio, o
// cancelamento com e sem execução durável, o prazo do veto, a pausa do daemon e a reordenação. Sem fábrica, sem durável.

const AGORA = 1_000_000;

function tarefa(extra: Partial<TarefaControle> = {}): TarefaControle {
  return {
    id: "p/K-1",
    project: "p",
    status: "enfileirada",
    stage: "spec",
    pauseRequested: false,
    durableId: null,
    gateId: null,
    reason: null,
    implementation: null,
    veto: null,
    ...extra,
  };
}

function portasFalsas(estado: EstadoControle, tipo: TipoDeBloqueio = null) {
  const abortadas: number[] = [];
  const portas: PortasControle = {
    alterar: async (fn) => fn(estado),
    abortar: async (id) => {
      abortadas.push(id);
    },
    agora: () => AGORA,
    tipoDeBloqueio: vi.fn(() => tipo),
  };
  return { controle: criarControleTarefas(portas), abortadas };
}

describe("Controle: pausar e retomar", () => {
  it("pausar uma Tarefa enfileirada a põe em pausada e marca o pedido", async () => {
    const t = tarefa();
    const { controle } = portasFalsas({ daemonPaused: false, tasks: [t] });
    expect(await controle.pausar("p/K-1")).toBe(true);
    expect(t).toMatchObject({ status: "pausada", pauseRequested: true });
  });

  it("pausar uma Tarefa em andamento só marca o pedido, sem mudar o status", async () => {
    const t = tarefa({ status: "em-andamento" });
    const { controle } = portasFalsas({ daemonPaused: false, tasks: [t] });
    await controle.pausar("p/K-1");
    expect(t).toMatchObject({ status: "em-andamento", pauseRequested: true });
  });

  it("pausar Tarefa terminada não muda nada", async () => {
    const t = tarefa({ status: "concluida" });
    const { controle } = portasFalsas({ daemonPaused: false, tasks: [t] });
    await controle.pausar("p/K-1");
    expect(t).toMatchObject({ status: "concluida", pauseRequested: false });
  });

  it("Tarefa inexistente devolve false", async () => {
    const { controle } = portasFalsas({ daemonPaused: false, tasks: [] });
    expect(await controle.pausar("p/X-1")).toBe(false);
    expect(await controle.retomar("p/X-1")).toBe(false);
  });

  it("retomar tira a pausa e volta a pausada para enfileirada", async () => {
    const t = tarefa({ status: "pausada", pauseRequested: true });
    const { controle } = portasFalsas({ daemonPaused: false, tasks: [t] });
    await controle.retomar("p/K-1");
    expect(t).toMatchObject({ status: "enfileirada", pauseRequested: false });
  });

  it("retomar uma linha de base bloqueada mede de novo e reenfileira", async () => {
    const t = tarefa({
      status: "bloqueada",
      durableId: 4,
      gateId: 5,
      reason: "baseline vermelho",
      implementation: { baseline: { falhou: true }, rejections: 0, feedback: null },
    });
    const { controle } = portasFalsas({ daemonPaused: false, tasks: [t] }, "baseline");
    await controle.retomar("p/K-1");
    expect(t).toMatchObject({ status: "enfileirada", durableId: null, gateId: null, reason: null });
    expect(t.implementation?.baseline).toBeNull();
  });

  it("retomar um TDD recusado zera as rejeições e o feedback", async () => {
    const t = tarefa({
      status: "bloqueada",
      reason: "TDD recusado 3 vezes",
      implementation: { baseline: null, rejections: 3, feedback: "refaça" },
    });
    const { controle } = portasFalsas({ daemonPaused: false, tasks: [t] }, "tdd");
    await controle.retomar("p/K-1");
    expect(t.implementation).toMatchObject({ rejections: 0, feedback: null });
    expect(t.status).toBe("enfileirada");
  });

  it("retomar uma sincronização recusada zera as tentativas só se estiver iniciada", async () => {
    const t = tarefa({
      status: "bloqueada",
      implementation: {
        baseline: null,
        rejections: 0,
        feedback: null,
        synchronization: { status: "iniciada", attempts: 4 },
      },
    });
    const { controle } = portasFalsas({ daemonPaused: false, tasks: [t] }, "base-sync");
    await controle.retomar("p/K-1");
    expect(t.implementation?.synchronization?.attempts).toBe(0);
    expect(t.status).toBe("enfileirada");
  });
});

describe("Controle: cancelar", () => {
  it("sem execução durável, cancela na hora", async () => {
    const t = tarefa();
    const { controle, abortadas } = portasFalsas({ daemonPaused: false, tasks: [t] });
    expect(await controle.cancelar("p/K-1")).toBe(true);
    expect(t.status).toBe("cancelada");
    expect(abortadas).toEqual([]);
  });

  it("com execução durável, aborta a execução e não mexe no status", async () => {
    const t = tarefa({ status: "em-andamento", durableId: 9 });
    const { controle, abortadas } = portasFalsas({ daemonPaused: false, tasks: [t] });
    await controle.cancelar("p/K-1");
    expect(abortadas).toEqual([9]);
    expect(t.status).toBe("em-andamento");
  });

  it("Tarefa terminada não é cancelada nem aborta nada", async () => {
    const t = tarefa({ status: "vetada", durableId: 9 });
    const { controle, abortadas } = portasFalsas({ daemonPaused: false, tasks: [t] });
    await controle.cancelar("p/K-1");
    expect(abortadas).toEqual([]);
    expect(t.status).toBe("vetada");
  });
});

describe("Controle: vetar", () => {
  it("dentro do prazo, veta, limpa o portão e aborta o portão", async () => {
    const t = tarefa({ status: "aguardando-veto", veto: { until: AGORA + 1 }, gateId: 7 });
    const { controle, abortadas } = portasFalsas({ daemonPaused: false, tasks: [t] });
    expect(await controle.vetar("p/K-1")).toBe("vetada");
    expect(t).toMatchObject({ status: "vetada", reason: "vetada pelo usuário", gateId: null });
    expect(abortadas).toEqual([7]);
  });

  it("depois do prazo, o veto não vale", async () => {
    const t = tarefa({ status: "aguardando-veto", veto: { until: AGORA }, gateId: 7 });
    const { controle, abortadas } = portasFalsas({ daemonPaused: false, tasks: [t] });
    expect(await controle.vetar("p/K-1")).toBe("fora-do-prazo");
    expect(t.status).toBe("aguardando-veto");
    expect(abortadas).toEqual([]);
  });

  it("Tarefa inexistente responde inexistente", async () => {
    const { controle } = portasFalsas({ daemonPaused: false, tasks: [] });
    expect(await controle.vetar("p/X-1")).toBe("inexistente");
  });
});

describe("Controle: daemon e fila", () => {
  it("retomar o daemon volta para a fila as Tarefas paradas só pela pausa do daemon", async () => {
    const parada = tarefa({ id: "p/K-1", status: "pausada", pauseRequested: false });
    const pedida = tarefa({ id: "p/K-2", status: "pausada", pauseRequested: true });
    const estado: EstadoControle = { daemonPaused: true, tasks: [parada, pedida] };
    const { controle } = portasFalsas(estado);
    await controle.pausarDaemon(false);
    expect(estado.daemonPaused).toBe(false);
    expect(parada.status).toBe("enfileirada");
    expect(pedida.status).toBe("pausada");
  });

  it("reordenar põe as Tarefas nomeadas à frente, na ordem dada, sem duplicar", async () => {
    const a = tarefa({ id: "p/A" });
    const b = tarefa({ id: "p/B" });
    const c = tarefa({ id: "p/C" });
    const estado: EstadoControle = { daemonPaused: false, tasks: [a, b, c] };
    const { controle } = portasFalsas(estado);
    await controle.reordenar(["p/C", "p/A", "p/C"]);
    expect(estado.tasks.map((t) => t.id)).toEqual(["p/C", "p/A", "p/B"]);
  });
});
