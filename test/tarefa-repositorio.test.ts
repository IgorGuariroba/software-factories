import { describe, expect, it, vi } from "vitest";
import type { RepoMapping } from "../src/config.js";
import type { Card } from "../src/demand-source.js";
import { escolherRepositorio, type PortasRepositorio } from "../src/packages/tarefa/index.js";

// Escolha do repositório da Tarefa com portas falsas: fixa que a escolha explícita vence, que sem ela vale o que o card
// identifica, que sem repositório que sirva a Tarefa pergunta (uma vez só) e espera, e que card ausente falha antes.

const teste = { command: ["npm", "test"], timeoutSeconds: 60, files: [] };
const repos: RepoMapping[] = [
  { path: "/dados/sf", prefix: "SF", test: teste },
  { path: "/dados/outro", prefix: "OUT", test: teste },
];
const card = { key: "SF-1", title: "x", status: "todo", assignee: "ana" } as unknown as Card;

function portasFalsas(sobrescritas: Partial<PortasRepositorio> = {}) {
  const perguntas: string[] = [];
  const portas: PortasRepositorio = {
    cartao: async () => card,
    caminhoEscolhido: async () => undefined,
    repositorios: () => repos,
    resolverPeloCard: () => repos[0],
    perguntaPendente: async () => false,
    perguntarRepositorio: vi.fn(async () => {
      perguntas.push("repositorio");
    }),
    ...sobrescritas,
  };
  return { portas, perguntas };
}

describe("Repositório: escolha", () => {
  it("card ausente falha antes de qualquer decisão", async () => {
    const { portas } = portasFalsas({ cartao: async () => Promise.reject(new Error("card SF-1 não existe mais")) });
    await expect(escolherRepositorio(portas)).rejects.toThrow("card SF-1 não existe mais");
  });

  it("escolha explícita válida vale sobre o que o card identifica", async () => {
    const { portas } = portasFalsas({ caminhoEscolhido: async () => "/dados/outro" });
    expect(await escolherRepositorio(portas)).toEqual({ caminho: "/dados/outro" });
  });

  it("escolha explícita de um caminho que não está mais configurado não serve", async () => {
    const { portas, perguntas } = portasFalsas({ caminhoEscolhido: async () => "/removido" });
    expect(await escolherRepositorio(portas)).toBe("aguardar");
    expect(perguntas).toEqual(["repositorio"]);
  });

  it("sem escolha, vale o repositório que o card identifica", async () => {
    const { portas } = portasFalsas();
    expect(await escolherRepositorio(portas)).toEqual({ caminho: "/dados/sf" });
  });

  it("sem repositório que sirva, pergunta e espera", async () => {
    const { portas, perguntas } = portasFalsas({ resolverPeloCard: () => undefined });
    expect(await escolherRepositorio(portas)).toBe("aguardar");
    expect(perguntas).toEqual(["repositorio"]);
  });

  it("pergunta já pendente: espera sem perguntar de novo", async () => {
    const { portas, perguntas } = portasFalsas({
      resolverPeloCard: () => undefined,
      perguntaPendente: async () => true,
    });
    expect(await escolherRepositorio(portas)).toBe("aguardar");
    expect(perguntas).toEqual([]);
  });

  it("projeto sem repositórios configurados segue sem caminho", async () => {
    const { portas } = portasFalsas({ repositorios: () => undefined, resolverPeloCard: () => undefined });
    expect(await escolherRepositorio(portas)).toEqual({ caminho: undefined });
  });
});
