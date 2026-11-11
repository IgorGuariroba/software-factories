import { describe, expect, it, vi } from "vitest";
import { criarPassosDaTarefa, type FiacaoTarefa } from "../src/fiacao-tarefa.js";

// Seam da fiação da Tarefa: os passos se constroem com dependências falsas, sem fábrica. Fixa os adaptadores que não
// dependem do runtime durável: o atraso de nova tentativa, a janela de veto do projeto, a classificação de bloqueio e de
// erro, e o anúncio de veto na atividade.

const configDoProjeto = { vetoMinutes: 2, activity: "always", calendar: {} } as never;

function dependencias(extra: Partial<FiacaoTarefa> = {}): FiacaoTarefa {
  return {
    retryDelayMs: 60_000,
    clock: { now: () => 1_000 },
    events: { append: vi.fn(async () => undefined), list: () => [] },
    eventRecorder: { append: vi.fn(), list: () => [] },
    implementationDeps: {} as never,
    implementationTools: {} as never,
    reviewTools: {} as never,
    projectOf: () => ({
      config: configDoProjeto,
      source: {} as never,
      writer: {} as never,
      channel: {} as never,
      codeHost: {} as never,
    }),
    opts: { models: {} as never },
    harness: {} as never,
    registry: {} as never,
    readState: async () => ({}) as never,
    forwardTechnical: async () => undefined,
    markQuestion: async () => undefined,
    perguntas: {} as never,
    inspectCard: async () => ({ kind: "seguir" }),
    ...extra,
  } as FiacaoTarefa;
}

describe("Fiação da Tarefa", () => {
  it("o atraso de nova tentativa vem da fiação", () => {
    expect(criarPassosDaTarefa(dependencias({ retryDelayMs: 1234 })).retryDelayMs).toBe(1234);
  });

  it("a janela de veto é a do projeto, em milissegundos", () => {
    expect(criarPassosDaTarefa(dependencias()).vetoMs?.({ project: "p" } as never)).toBe(2 * 60_000);
  });

  it("classificação: falha de guardrail ou de etapa bloqueia; outro erro vira erro", () => {
    const passos = criarPassosDaTarefa(dependencias());
    expect(passos.classify(new Error("falhou"))).toEqual({ kind: "error", message: "falhou" });
  });

  it("o anúncio de veto registra um aviso com o prazo e o botão de vetar na atividade", async () => {
    const append = vi.fn(async () => undefined);
    const passos = criarPassosDaTarefa(dependencias({ events: { append, list: () => [] } }));
    await passos.announceVeto?.({ id: "p/K-1", project: "p", key: "K-1" } as never, 5_000);
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ type: "notify", reason: "aguardando-veto", target: "K-1" }),
    );
  });
});
