import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import { conflitoProjeto, montarProjetoGithub, padroesDe, sugerirProjeto } from "../src/projetos-github.js";

const referencia = {
  name: "sf",
  source: {
    type: "github",
    project: "SF",
    repo: "dono/sf",
    assignee: "dono",
    triageApproval: true,
    maxActive: 3,
    ignoreLabels: ["epic"],
  },
  roles: { spec: { provider: "openai", model: "gpt" }, reviewer: { provider: "openrouter", model: "claude" } },
  statuses: { aberta: "todo", fechada: "done" },
} as unknown as ProjectConfig;

const padroes = padroesDe(referencia);

describe("montarProjetoGithub: o projeto novo a partir do padrão", () => {
  it("herda modelos e estados do projeto de referência, com o dono como PO", () => {
    const config = montarProjetoGithub({ padroes, repo: "dono/novo", nome: "novo", prefixo: "NV", ensaio: true });
    expect(config).toMatchObject({
      name: "novo",
      dryRun: true,
      roles: referencia.roles,
      statuses: referencia.statuses,
      people: [{ id: "dono", role: "po" }],
      source: { type: "github", project: "NV", repo: "dono/novo", assignee: "dono", maxActive: 1 },
    });
  });

  it("sem ensaio, o projeto sai com dryRun desligado", () => {
    expect(montarProjetoGithub({ padroes, repo: "dono/novo", nome: "novo", prefixo: "NV", ensaio: false }).dryRun).toBe(
      false,
    );
  });

  it("nome inválido é recusado com a regra em português", () => {
    expect(() =>
      montarProjetoGithub({ padroes, repo: "dono/x", nome: "Com Espaço", prefixo: "NV", ensaio: true }),
    ).toThrow(/nome: use minúsculas/);
  });

  it("prefixo inválido é recusado", () => {
    expect(() => montarProjetoGithub({ padroes, repo: "dono/x", nome: "novo", prefixo: "1A", ensaio: true })).toThrow(
      /prefixo: use de 2 a 10/,
    );
  });
});

describe("sugerirProjeto: nome e prefixo iniciais", () => {
  it("usa o nome do repositório e as iniciais das palavras", () => {
    expect(sugerirProjeto("dono/software-factories")).toEqual({ nome: "software-factories", prefixo: "SF" });
  });

  it("sugestões passam na validação do projeto", () => {
    for (const repo of ["dono/Meu.Projeto", "dono/1-api", "dono/a", "dono/x_y_z_w_v"]) {
      const { nome, prefixo } = sugerirProjeto(repo);
      expect(() => montarProjetoGithub({ padroes, repo, nome, prefixo, ensaio: true })).not.toThrow();
    }
  });
});

describe("conflitoProjeto: o que impede um projeto novo", () => {
  const existentes = [referencia];
  it("sem conflito, devolve undefined", () => {
    expect(conflitoProjeto({ nome: "novo", prefixo: "NV", repo: "dono/novo" }, existentes)).toBeUndefined();
  });

  it("nome igual já existe", () => {
    expect(conflitoProjeto({ nome: "sf", prefixo: "XX", repo: "dono/outro" }, existentes)).toMatch(
      /já existe um projeto/,
    );
  });

  it("prefixo igual, sem diferenciar caixa, colidiria nas chaves dos cards", () => {
    expect(conflitoProjeto({ nome: "novo", prefixo: "sf", repo: "dono/outro" }, existentes)).toMatch(/prefixo SF/);
  });

  it("o mesmo repositório não pode ter dois projetos", () => {
    expect(conflitoProjeto({ nome: "novo", prefixo: "NV", repo: "DONO/SF" }, existentes)).toMatch(/já é monitorado/);
  });
});
