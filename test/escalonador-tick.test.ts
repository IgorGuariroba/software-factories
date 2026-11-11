import { describe, expect, it, vi } from "vitest";
import { criarEscalonador, type PortasEscalonador } from "../src/packages/escalonador/index.js";

// Tick periódico de busca: fixa que o tick pede uma busca quando não há nenhuma pendente, e que pula quando já há uma
// (para não acumular buscas com a Fonte lenta).

function portas(buscar: () => Promise<void>): PortasEscalonador {
  return {
    buscar,
    estado: async () => ({ daemonPaused: false, tasks: [] }),
    agora: () => 1_000,
    armTimer: () => () => undefined,
    proximaAtividade: (_projeto: string, momento: number) => momento,
    projetoConfigurado: () => true,
    pendenciasBloqueantes: () => [],
    repoDesativado: () => false,
    projetoPausado: () => false,
    ativar: vi.fn(async () => undefined),
    registrarEvento: vi.fn(async () => undefined),
    registrarErro: vi.fn(),
  } as unknown as PortasEscalonador;
}

describe("Escalonador: tick periódico de busca", () => {
  it("sem busca pendente, o tick pede uma busca", async () => {
    const buscar = vi.fn(async () => undefined);
    const esc = await criarEscalonador(portas(buscar));
    esc.pedirBuscaPeriodica();
    await esc.ociosa();
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("com busca ainda em andamento, o tick pula e não acumula outra", async () => {
    let liberar!: () => void;
    const buscar = vi.fn(() => new Promise<void>((resolver) => (liberar = resolver)));
    const esc = await criarEscalonador(portas(buscar));
    esc.pedirBuscaPeriodica();
    await vi.waitFor(() => expect(buscar).toHaveBeenCalledTimes(1));
    esc.pedirBuscaPeriodica();
    expect(buscar).toHaveBeenCalledTimes(1);
    liberar();
    await esc.ociosa();
  });
});
