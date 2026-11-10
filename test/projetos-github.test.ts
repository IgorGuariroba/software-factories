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

/** Projeto novo com a Fonte GitHub Issues do próprio repositório, em ensaio, horário comercial. */
const novo = (sobrescrita: Partial<Parameters<typeof montarProjetoGithub>[0]> = {}) =>
  montarProjetoGithub({
    padroes,
    repo: "dono/novo",
    caminho: "/dados/repositorios/novo",
    nome: "novo",
    fonte: { type: "github", project: "NV", assignee: "dono" },
    horario: "business-hours",
    ensaio: true,
    comandoTeste: ["npm", "test"],
    ...sobrescrita,
  });

describe("montarProjetoGithub: o projeto novo a partir do padrão e do que o usuário escolheu", () => {
  it("herda modelos e estados do projeto de referência, sem pessoas: PO e tech lead ficam como pendência", () => {
    expect(novo()).toMatchObject({
      name: "novo",
      dryRun: true,
      activity: "business-hours",
      roles: referencia.roles,
      statuses: referencia.statuses,
      people: [],
      source: { type: "github", project: "NV", repo: "dono/novo", assignee: "dono", maxActive: 1 },
      repositories: [{ path: "/dados/repositorios/novo", prefix: "NV", test: { command: ["npm", "test"] } }],
    });
  });

  it("a Fonte escolhida vale: Jira com a chave do projeto, sem GitHub Issues", () => {
    const config = novo({
      fonte: { type: "jira", project: "proj", assignee: "accountid-1", baseUrl: "https://empresa.atlassian.net" },
    });
    expect(config.source).toMatchObject({ type: "jira", project: "PROJ", assignee: "accountid-1" });
    expect(config.repositories?.[0]?.prefix).toBe("PROJ");
  });

  it("GitLab mantém o caminho do próprio projeto, que pode ser outro repositório", () => {
    const config = novo({ fonte: { type: "gitlab", project: "GL", repo: "grupo/app", assignee: "fulano" } });
    expect(config.source).toMatchObject({ type: "gitlab", repo: "grupo/app" });
  });

  it("sem ensaio, o projeto sai com dryRun desligado; horário sempre ativo quando escolhido", () => {
    expect(novo({ ensaio: false, horario: "always" })).toMatchObject({ dryRun: false, activity: "always" });
  });

  it("nome inválido é recusado com a regra em português", () => {
    expect(() => novo({ nome: "Com Espaço" })).toThrow(/nome: use minúsculas/);
  });

  it("prefixo inválido é recusado", () => {
    expect(() => novo({ fonte: { type: "github", project: "1A", assignee: "dono" } })).toThrow(
      /prefixo: use de 2 a 10/,
    );
  });

  it("comando de teste vazio não recusa a criação: o projeto nasce sem comando, com a pendência", () => {
    expect(novo({ comandoTeste: [] }).repositories?.[0]?.test.command).toEqual([]);
  });
});

describe("sugerirProjeto: nome e prefixo iniciais", () => {
  it("usa o nome do repositório e as iniciais das palavras", () => {
    expect(sugerirProjeto("dono/software-factories")).toEqual({ nome: "software-factories", prefixo: "SF" });
  });

  it("sugestões passam na validação do projeto", () => {
    for (const repo of ["dono/Meu.Projeto", "dono/1-api", "dono/a", "dono/x_y_z_w_v"]) {
      const { nome, prefixo } = sugerirProjeto(repo);
      expect(() => novo({ repo, nome, fonte: { type: "github", project: prefixo, assignee: "dono" } })).not.toThrow();
    }
  });
});

describe("conflitoProjeto: o que impede um projeto novo", () => {
  const existentes = [referencia];
  const github = { nome: "novo", prefixo: "NV", fonteTipo: "github", fonteRepo: "dono/novo" };

  it("sem conflito, devolve undefined", () => {
    expect(conflitoProjeto(github, existentes)).toBeUndefined();
  });

  it("nome igual já existe", () => {
    expect(conflitoProjeto({ ...github, nome: "sf", prefixo: "XX", fonteRepo: "dono/outro" }, existentes)).toMatch(
      /já existe um projeto/,
    );
  });

  it("prefixo igual, sem diferenciar caixa, colidiria nas chaves dos cards", () => {
    expect(conflitoProjeto({ ...github, prefixo: "sf", fonteRepo: "dono/outro" }, existentes)).toMatch(/prefixo SF/);
  });

  it("a mesma Fonte de issues no mesmo repositório não pode ter dois projetos, sem diferenciar caixa", () => {
    expect(conflitoProjeto({ ...github, fonteRepo: "DONO/SF" }, existentes)).toMatch(/já tem a Fonte github/);
  });

  it("o mesmo repositório com outra Fonte (Jira) é permitido", () => {
    expect(conflitoProjeto({ nome: "novo", prefixo: "NV", fonteTipo: "jira" }, existentes)).toBeUndefined();
  });

  it("GitHub Issues e GitLab Issues no mesmo repositório não são a mesma Fonte", () => {
    expect(conflitoProjeto({ ...github, fonteTipo: "gitlab", fonteRepo: "dono/sf" }, existentes)).toBeUndefined();
  });
});
