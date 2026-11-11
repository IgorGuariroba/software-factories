import { describe, expect, it } from "vitest";
import type { GitHubAppStatus } from "../src/github-app.js";
import {
  criarRepositoriosGitHub,
  type EstadoRepositorios,
  type PortasRepositoriosGitHub,
  projetoDoRepositorio,
} from "../src/packages/repositorios-github/index.js";

// Leituras de repositórios do GitHub com portas falsas: fixa a listagem com vínculo padrão, o catálogo com plugue e
// importação (sem diferenciar caixa), e o painel que só afirma cobertura quando a consulta ao App deu certo.

const app: GitHubAppStatus = {
  configurado: true,
  consultadoEm: "2026-11-10T00:00:00.000Z",
  instalacoes: [
    {
      id: 7,
      conta: "dono",
      selecao: "all",
      repositorios: ["dono/novo", "dono/outro"],
      catalogo: [
        { id: 42, nome: "dono/novo", dono: "dono", privado: false, instalacaoId: 7 },
        { id: 43, nome: "dono/outro", dono: "dono", privado: true, instalacaoId: 7 },
      ],
    },
  ],
};

function portasFalsas(estado: EstadoRepositorios, sobrescritas: Partial<PortasRepositoriosGitHub> = {}) {
  const portas: PortasRepositoriosGitHub = {
    estado: async () => estado,
    projetosGitHub: () => [
      { nome: "nv", repo: "Dono/Novo" },
      { nome: "outro", repo: "dono/outro" },
    ],
    statusDoApp: async () => app,
    receptor: () => ({ ligado: true, porta: 9000 }),
    ...sobrescritas,
  };
  return criarRepositoriosGitHub(portas);
}

describe("Repositórios GitHub: listagem", () => {
  it("sem vínculo gravado, o repositório está ativo", async () => {
    const repos = portasFalsas({});
    expect(await repos.listar()).toEqual([
      { project: "nv", repo: "Dono/Novo", status: "ativo", installationId: null, motivo: null },
      { project: "outro", repo: "dono/outro", status: "ativo", installationId: null, motivo: null },
    ]);
  });

  it("vínculo desativado aparece com o motivo e a instalação", async () => {
    const repos = portasFalsas({
      repos: { outro: { status: "desativado", installationId: 7, motivo: "removido pelo usuário" } },
    });
    const outro = (await repos.listar()).find((r) => r.project === "outro");
    expect(outro).toMatchObject({ status: "desativado", installationId: 7, motivo: "removido pelo usuário" });
  });
});

describe("Repositórios GitHub: catálogo", () => {
  it("marca o repositório plugado sem diferenciar caixa e mostra a importação dele", async () => {
    const repos = portasFalsas({
      importacoes: { "42": { repoId: 42, repo: "dono/novo", status: "ok" } },
    });
    const catalogo = await repos.catalogo();
    expect(catalogo.configurado).toBe(true);
    const novo = catalogo.repos.find((r) => r.id === 42);
    expect(novo?.plugado).toEqual({ projeto: "nv", status: "ativo" });
    expect(novo?.importacao).toMatchObject({ status: "ok" });
    expect(catalogo.repos.find((r) => r.id === 43)).toMatchObject({ plugado: { projeto: "outro" }, importacao: null });
  });

  it("App com erro não lista repositórios e leva o erro", async () => {
    const repos = portasFalsas({}, { statusDoApp: async () => ({ ...app, erro: "token expirou" }) });
    const catalogo = await repos.catalogo();
    expect(catalogo).toMatchObject({ configurado: true, erro: "token expirou", repos: [] });
  });
});

describe("Repositórios GitHub: painel", () => {
  it("cobertura de repositório ativo vem da instalação; desativado não tem cobertura", async () => {
    const repos = portasFalsas({ repos: { outro: { status: "desativado" } } });
    const painel = await repos.painel();
    expect(painel.repositorios).toEqual([
      expect.objectContaining({ projeto: "nv", coberto: true }),
      expect.objectContaining({ projeto: "outro", coberto: null }),
    ]);
    expect(painel.receptor).toEqual({ ligado: true, porta: 9000, ultimaEntregaEm: null });
  });

  it("sem consulta ao App, a cobertura não é afirmada (null)", async () => {
    const repos = portasFalsas(
      { ultimoWebhookEm: "2026-11-09T00:00:00.000Z" },
      {
        statusDoApp: async () => ({ configurado: true, consultadoEm: "x", erro: "falhou", instalacoes: [] }),
      },
    );
    const painel = await repos.painel();
    expect(painel.repositorios.every((r) => r.coberto === null)).toBe(true);
    expect(painel.receptor.ultimaEntregaEm).toBe("2026-11-09T00:00:00.000Z");
  });
});

describe("Repositórios GitHub: projeto do repositório", () => {
  const projetos = [
    { nome: "nv", repo: "Dono/Novo" },
    { nome: "outro", repo: "dono/outro" },
  ];

  it("acha o projeto sem diferenciar caixa", () => {
    expect(projetoDoRepositorio(projetos, "dono/NOVO")?.nome).toBe("nv");
  });

  it("repositório que nenhum projeto monitora não acha nada", () => {
    expect(projetoDoRepositorio(projetos, "dono/outro-ainda")).toBeUndefined();
  });
});
