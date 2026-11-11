import { describe, expect, it, vi } from "vitest";
import {
  type AlvoExecucao,
  ativarTarefa,
  type EstadoAtivacao,
  type PortasAtivacao,
  type TarefaAtivacao,
} from "../src/packages/escalonador/index.js";

// Ativação da próxima Tarefa com portas falsas: fixa que só uma Tarefa fica ativa por vez, que a ativação parte só de
// estados que esperam, que um portão aberto substitui a execução nova, e que a Tarefa ativada sai do aviso de espera.

function tarefa(extra: Partial<TarefaAtivacao> = {}): TarefaAtivacao {
  return {
    id: "p/K-1",
    project: "p",
    key: "K-1",
    status: "enfileirada",
    notBefore: 123,
    durableId: null,
    gateId: null,
    ...extra,
  };
}

function portasFalsas(estado: EstadoAtivacao) {
  const execucoes: AlvoExecucao[] = [];
  const portoesAbertos: number[] = [];
  const portas: PortasAtivacao = {
    alterar: async (fn) => {
      await fn(
        estado,
        vi.fn(async (alvo: AlvoExecucao) => {
          execucoes.push(alvo);
          return 77;
        }),
      );
    },
    abrirPortao: async (id) => {
      portoesAbertos.push(id);
    },
  };
  return { portas, execucoes, portoesAbertos };
}

describe("Ativação: quem ativa", () => {
  it("enfileirada sem portão: nasce a execução durável e a Tarefa fica ativa", async () => {
    const t = tarefa();
    const { portas, execucoes, portoesAbertos } = portasFalsas({ tasks: [t] });
    await ativarTarefa(portas, "p/K-1");
    expect(t).toMatchObject({ status: "ativa", notBefore: null, durableId: 77 });
    expect(execucoes).toEqual([{ id: "p/K-1", project: "p", key: "K-1" }]);
    expect(portoesAbertos).toEqual([]);
  });

  it("aguardando entrega também é ativada", async () => {
    const t = tarefa({ status: "aguardando-entrega" });
    const { portas } = portasFalsas({ tasks: [t] });
    await ativarTarefa(portas, "p/K-1");
    expect(t.status).toBe("ativa");
  });

  it("com portão, abre o portão em vez de criar execução nova", async () => {
    const t = tarefa({ gateId: 5 });
    const { portas, execucoes, portoesAbertos } = portasFalsas({ tasks: [t] });
    await ativarTarefa(portas, "p/K-1");
    expect(portoesAbertos).toEqual([5]);
    expect(execucoes).toEqual([]);
    expect(t).toMatchObject({ status: "ativa", gateId: null, durableId: null });
  });

  it("só uma Tarefa ativa por vez: outra ativação não acontece", async () => {
    const ativa = tarefa({ id: "p/K-0", status: "ativa", durableId: 1 });
    const espera = tarefa();
    const { portas, execucoes } = portasFalsas({ tasks: [ativa, espera] });
    await ativarTarefa(portas, "p/K-1");
    expect(espera.status).toBe("enfileirada");
    expect(execucoes).toEqual([]);
  });

  it("estado que não espera ativação não é ativado", async () => {
    const t = tarefa({ status: "bloqueada" });
    const { portas, execucoes } = portasFalsas({ tasks: [t] });
    await ativarTarefa(portas, "p/K-1");
    expect(t.status).toBe("bloqueada");
    expect(execucoes).toEqual([]);
  });

  it("Tarefa inexistente não faz nada", async () => {
    const { portas, execucoes, portoesAbertos } = portasFalsas({ tasks: [] });
    await ativarTarefa(portas, "p/X-1");
    expect(execucoes).toEqual([]);
    expect(portoesAbertos).toEqual([]);
  });
});
