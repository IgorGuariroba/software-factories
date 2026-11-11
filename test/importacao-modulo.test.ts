import { describe, expect, it, vi } from "vitest";
import {
  criarImportacao,
  type EstadoImportacao,
  type PortasImportacao,
  type RegistroImportacao,
} from "../src/packages/importacao/index.js";

// Importação de repositórios com portas falsas: fixa a máquina de estados (importando → ok ou erro), a preservação do
// último resultado bom quando uma importação falha, a redação do erro e a fila em ordem. Sem GitHub, sem fábrica.

type Issue = { numero: number };
type Efeito = { tipo: string };

function estadoCom(registro: RegistroImportacao): EstadoImportacao {
  return { importacoes: { [String(registro.repoId)]: registro } };
}

const importando = (extra: Partial<RegistroImportacao> = {}): RegistroImportacao => ({
  repoId: 7,
  repo: "dono/repo",
  status: "importando",
  ...extra,
});

function portasFalsas(estado: EstadoImportacao, sobrescritas: Partial<PortasImportacao<Issue, Efeito>> = {}) {
  const efeitosExecutados: Efeito[][] = [];
  const portas: PortasImportacao<Issue, Efeito> = {
    estado: async () => estado,
    alterar: async (fn) => fn(estado),
    agora: () => Date.UTC(2026, 0, 2, 3, 4, 5),
    statusDoApp: async () => ({ configurado: true }),
    repoDoApp: async (repoId) => ({ id: repoId, nome: "dono/repo", instalacaoId: 99 }),
    projetoDoRepo: () => "projeto-a",
    issuesAbertas: async () => [{ numero: 1 }, { numero: 2 }],
    aplicar: vi.fn((_estado, alvo) => ({
      resultado: { criadas: alvo.issues.length, vinculadas: 0, atualizadas: 0, ignoradas: 0 },
      efeitos: [{ tipo: "criada" }],
    })),
    executarEfeitos: async (efeitos) => {
      efeitosExecutados.push(efeitos);
    },
    redigir: (texto) => texto.replace(/token-\w+/g, "[redigido]"),
    ...sobrescritas,
  };
  return { importacao: criarImportacao(portas), portas, efeitosExecutados };
}

describe("Importação: máquina de estados", () => {
  it("importa as issues abertas, grava o resultado e executa os efeitos", async () => {
    const estado = estadoCom(importando());
    const { importacao, efeitosExecutados } = portasFalsas(estado);
    importacao.enfileirar(7);
    await importacao.ociosa();
    const registro = estado.importacoes?.["7"];
    expect(registro).toMatchObject({
      status: "ok",
      repo: "dono/repo",
      installationId: 99,
      ultimaImportacaoEm: "2026-01-02T03:04:05.000Z",
      ultimoResultado: { criadas: 2, vinculadas: 0, atualizadas: 0, ignoradas: 0 },
    });
    expect(efeitosExecutados).toEqual([[{ tipo: "criada" }]]);
  });

  it("registro que não está em importando não lê nada nem muda o estado", async () => {
    const estado = estadoCom(importando({ status: "ok" }));
    const issuesAbertas = vi.fn(async () => []);
    const { importacao } = portasFalsas(estado, { issuesAbertas });
    importacao.enfileirar(7);
    await importacao.ociosa();
    expect(issuesAbertas).not.toHaveBeenCalled();
    expect(estado.importacoes?.["7"].status).toBe("ok");
  });

  it("GitHub App não configurado vira erro, com a mensagem do App", async () => {
    const estado = estadoCom(importando());
    const { importacao, portas } = portasFalsas(estado, {
      statusDoApp: async () => ({ configurado: false }),
    });
    importacao.enfileirar(7);
    await importacao.ociosa();
    expect(estado.importacoes?.["7"]).toMatchObject({ status: "erro", ultimoErro: "GitHub App não configurado" });
    expect(portas.aplicar).not.toHaveBeenCalled();
  });

  it("repositório que saiu do catálogo do App vira erro", async () => {
    const estado = estadoCom(importando());
    const { importacao } = portasFalsas(estado, { repoDoApp: async () => undefined });
    importacao.enfileirar(7);
    await importacao.ociosa();
    expect(estado.importacoes?.["7"]).toMatchObject({
      status: "erro",
      ultimoErro: "dono/repo não está mais no catálogo do App",
    });
  });

  it("repositório sem projeto monitorado vira erro", async () => {
    const estado = estadoCom(importando());
    const { importacao } = portasFalsas(estado, { projetoDoRepo: () => undefined });
    importacao.enfileirar(7);
    await importacao.ociosa();
    expect(estado.importacoes?.["7"]).toMatchObject({
      status: "erro",
      ultimoErro: "nenhum projeto monitora dono/repo",
    });
  });

  it("falha depois de uma importação boa mantém o último resultado e a instalação, e redige o erro", async () => {
    const estado = estadoCom(
      importando({
        installationId: 55,
        ultimaImportacaoEm: "2025-12-31T00:00:00.000Z",
        ultimoResultado: { criadas: 4, vinculadas: 1, atualizadas: 0, ignoradas: 0 },
      }),
    );
    const { importacao, efeitosExecutados } = portasFalsas(estado, {
      issuesAbertas: async () => {
        throw new Error("falhou com token-abc123");
      },
    });
    importacao.enfileirar(7);
    await importacao.ociosa();
    const registro = estado.importacoes?.["7"];
    expect(registro).toEqual({
      repoId: 7,
      repo: "dono/repo",
      status: "erro",
      installationId: 55,
      ultimaImportacaoEm: "2025-12-31T00:00:00.000Z",
      ultimoResultado: { criadas: 4, vinculadas: 1, atualizadas: 0, ignoradas: 0 },
      ultimoErro: "falhou com [redigido]",
    });
    expect(efeitosExecutados).toEqual([]);
  });

  it("se a aplicação falhar, nenhum efeito é executado", async () => {
    const estado = estadoCom(importando());
    const { importacao, efeitosExecutados } = portasFalsas(estado, {
      aplicar: () => {
        throw new Error("projeto projeto-a não está carregado");
      },
    });
    importacao.enfileirar(7);
    await importacao.ociosa();
    expect(estado.importacoes?.["7"]).toMatchObject({
      status: "erro",
      ultimoErro: "projeto projeto-a não está carregado",
    });
    expect(efeitosExecutados).toEqual([]);
  });
});

describe("Importação: fila", () => {
  it("roda uma importação por vez, na ordem em que foram enfileiradas", async () => {
    const estado: EstadoImportacao = {
      importacoes: {
        "1": importando({ repoId: 1, repo: "dono/um" }),
        "2": importando({ repoId: 2, repo: "dono/dois" }),
      },
    };
    const ordem: string[] = [];
    let liberarPrimeira!: () => void;
    const { importacao } = portasFalsas(estado, {
      repoDoApp: async (repoId) => ({ id: repoId, nome: `dono/${repoId}`, instalacaoId: 1 }),
      issuesAbertas: async (nome) => {
        ordem.push(`inicio ${nome}`);
        if (nome === "dono/1") await new Promise<void>((r) => (liberarPrimeira = r));
        ordem.push(`fim ${nome}`);
        return [];
      },
    });
    importacao.enfileirar(1);
    importacao.enfileirar(2);
    await vi.waitFor(() => expect(ordem).toEqual(["inicio dono/1"]));
    liberarPrimeira();
    await importacao.ociosa();
    expect(ordem).toEqual(["inicio dono/1", "fim dono/1", "inicio dono/2", "fim dono/2"]);
  });
});
