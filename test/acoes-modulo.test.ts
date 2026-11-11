import { describe, expect, it, vi } from "vitest";
import { criarAcoes, type PortasAcoes, type TarefaAcoes } from "../src/packages/acoes/index.js";

// Ações humanas sobre a Tarefa com portas falsas: fixa as etapas que aceitam esquecer memória, a conversa esquecida, a
// exigência de revisão exata e aprovação explícita no reparo, e o progresso registrado. Sem fábrica, sem repositório.

const REVISAO = "a".repeat(64);

function portasFalsas(tarefa: TarefaAcoes | undefined, sobrescritas: Partial<PortasAcoes> = {}) {
  const alteracoes: TarefaAcoes[] = [];
  const progressos: string[] = [];
  const portas: PortasAcoes = {
    tarefa: async () => tarefa,
    alterar: async (_id, fn) => {
      if (tarefa) fn(tarefa);
      alteracoes.push(structuredClone(tarefa ?? { id: "" }));
    },
    previaReparo: vi.fn(async () => ({ preview: true })),
    integrarReparo: vi.fn(async () => ({ ticket: 2, sha: "abcdef1234567" })),
    registrarProgresso: async (_id, mensagem) => {
      progressos.push(mensagem);
    },
    ...sobrescritas,
  };
  return { acoes: criarAcoes(portas), portas, alteracoes, progressos };
}

describe("Ações: esquecer memória", () => {
  it("tarefa inexistente responde 404", async () => {
    const { acoes } = portasFalsas(undefined);
    expect((await acoes.esquecerMemoria("p/K-1", "spec")).status).toBe(404);
  });

  it("implementação não permite esquecer memória", async () => {
    const { acoes } = portasFalsas({ id: "p/K-1" });
    expect(await acoes.esquecerMemoria("p/K-1", "implementacao")).toEqual({
      status: 409,
      body: { error: "a etapa implementacao ainda não permite esquecer a memória" },
    });
  });

  it("etapa sem conversa responde 409", async () => {
    const { acoes } = portasFalsas({ id: "p/K-1", specConversationId: null });
    expect((await acoes.esquecerMemoria("p/K-1", "spec")).status).toBe(409);
  });

  it("esquece a SPEC: a conversa vai para as esquecidas e sai da etapa", async () => {
    const tarefa: TarefaAcoes = { id: "p/K-1", specConversationId: "conv-spec", conversasEsquecidas: ["antiga"] };
    const { acoes } = portasFalsas(tarefa);
    expect(await acoes.esquecerMemoria("p/K-1", "spec")).toEqual({
      status: 200,
      body: { etapa: "spec", esquecida: true },
    });
    expect(tarefa.specConversationId).toBeNull();
    expect(tarefa.conversasEsquecidas).toEqual(["antiga", "conv-spec"]);
  });

  it("esquece a revisão e a retrô de uma etapa específica", async () => {
    const tarefa: TarefaAcoes = {
      id: "p/K-1",
      review: { conversationId: "conv-review" },
      retros: [
        { stage: "spec", conversationId: "conv-retro-spec" },
        { stage: "review", conversationId: "conv-retro-review" },
      ],
    };
    const { acoes } = portasFalsas(tarefa);
    await acoes.esquecerMemoria("p/K-1", "review");
    expect(tarefa.review?.conversationId).toBeNull();
    await acoes.esquecerMemoria("p/K-1", "retro:review");
    expect(tarefa.retros?.[1].conversationId).toBeNull();
    expect(tarefa.retros?.[0].conversationId).toBe("conv-retro-spec");
  });

  it("'retro:' sem nome da etapa não é etapa permitida", async () => {
    const { acoes } = portasFalsas({ id: "p/K-1" });
    expect((await acoes.esquecerMemoria("p/K-1", "retro:")).status).toBe(409);
  });
});

describe("Ações: reparo humano", () => {
  it("prévia devolve o que o pacote de reparo montou", async () => {
    const { acoes, portas } = portasFalsas({ id: "p/K-1" });
    expect(await acoes.previaReparo("p/K-1")).toEqual({ status: 200, body: { preview: true } });
    expect(portas.previaReparo).toHaveBeenCalledTimes(1);
  });

  it("sem revisão exata (hash) ou sem aprovação explícita dos testes, responde 400 e não integra", async () => {
    const { acoes, portas } = portasFalsas({ id: "p/K-1" });
    const ruim = {
      status: 400,
      body: { error: "exige revisão exata e aprovação explícita dos reparos, inclusive nos testes" },
    };
    expect(await acoes.aplicarReparo("p/K-1", { revision: "curta", approveTestChanges: true })).toEqual(ruim);
    expect(await acoes.aplicarReparo("p/K-1", { revision: REVISAO, approveTestChanges: false })).toEqual(ruim);
    expect(portas.integrarReparo).not.toHaveBeenCalled();
  });

  it("aplicado: integra com a revisão, registra o progresso e devolve o resultado", async () => {
    const { acoes, portas, progressos } = portasFalsas({ id: "p/K-1" });
    const r = await acoes.aplicarReparo("p/K-1", { revision: REVISAO, approveTestChanges: true });
    expect(portas.integrarReparo).toHaveBeenCalledWith("p/K-1", REVISAO);
    expect(r).toEqual({ status: 200, body: { ticket: 2, sha: "abcdef1234567" } });
    expect(progressos).toEqual([
      "Reparo humano aprovado e validado para o ticket 3: commit abcdef12. Tarefa continua bloqueada até retomada explícita.",
    ]);
  });

  it("tarefa inexistente responde 404 antes de qualquer checagem", async () => {
    const { acoes, portas } = portasFalsas(undefined);
    expect((await acoes.aplicarReparo("p/K-1", {})).status).toBe(404);
    expect(portas.integrarReparo).not.toHaveBeenCalled();
  });
});
