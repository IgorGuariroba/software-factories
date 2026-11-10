import { describe, expect, it } from "vitest";
import {
  camposDaFonte,
  configDoFormulario,
  estadoDoFormulario,
  fonteDoFormulario,
  linhaDaCredencial,
  opcoesDeCredenciais,
  perfisDoFormulario,
  pessoasDoFormulario,
  provedoresDoFormulario,
  repositoriosDoFormulario,
  resumoHistorico,
} from "../web/projeto-config.js";

// Apresentação pura da página de configuração de projeto (fatias 02 a 12, pela interface).
describe("página de configuração de projeto: conversão do formulário", () => {
  const esquemaGithub = [
    { campo: "project", rotulo: "Prefixo", tipo: "texto", obrigatorio: true },
    { campo: "repo", rotulo: "Repositório", tipo: "texto", obrigatorio: true },
    { campo: "assignee", rotulo: "Dono", tipo: "texto", obrigatorio: true },
    { campo: "ignoreLabels", rotulo: "Labels ignoradas", tipo: "lista", obrigatorio: false },
  ];

  it("mostra os campos do schema com o valor atual, listas como texto separado por vírgula", () => {
    const campos = camposDaFonte(esquemaGithub, {
      type: "github",
      project: "SF",
      repo: "dono/repo",
      assignee: "dono",
      ignoreLabels: ["epic", "bug"],
    });

    expect(campos.find((c) => c.campo === "ignoreLabels")?.valor).toBe("epic, bug");
    expect(campos.find((c) => c.campo === "repo")?.valor).toBe("dono/repo");
  });

  it("monta a Fonte a partir do formulário, separando listas e omitindo campos vazios", () => {
    const fonte = fonteDoFormulario("github", esquemaGithub, {
      project: "SF",
      repo: "dono/repo",
      assignee: "dono",
      ignoreLabels: " epic , , bug ",
    });

    expect(fonte).toEqual({
      type: "github",
      project: "SF",
      repo: "dono/repo",
      assignee: "dono",
      ignoreLabels: ["epic", "bug"],
    });
  });

  it("não envia campo opcional vazio", () => {
    const fonte = fonteDoFormulario("github", esquemaGithub, {
      project: "SF",
      repo: "dono/repo",
      assignee: "dono",
      ignoreLabels: "",
    });

    expect(fonte).not.toHaveProperty("ignoreLabels");
  });

  it("perfis: descarta linhas sem nome e aceita só papéis conhecidos", () => {
    expect(
      perfisDoFormulario([
        { nome: "Analista de negócio", papel: "po" },
        { nome: "  ", papel: "po" },
        { nome: "Arquiteto", papel: "invalido" },
      ]),
    ).toEqual([
      { nome: "Analista de negócio", papel: "po" },
      { nome: "Arquiteto", papel: "outro" },
    ]);
  });

  it("pessoas: exige identificador, separa os perfis e guarda só as identidades preenchidas", () => {
    expect(
      pessoasDoFormulario([
        { id: "acc-edgar", perfis: "Analista de negócio, Arquiteto", teams: "8:orgid:edgar", jira: "", github: "" },
        { id: "", perfis: "Tech Lead", teams: "", jira: "", github: "" },
      ]),
    ).toEqual([
      {
        id: "acc-edgar",
        perfis: ["Analista de negócio", "Arquiteto"],
        identidades: { teams: "8:orgid:edgar" },
      },
    ]);
  });

  it("o nível de conteúdo do Telegram do projeto vai para a configuração, sem perder outros campos do bloco", () => {
    const atual = { name: "exemplo", telegram: { content: "full", outroCampo: 1 } };

    const nova = configDoFormulario(atual, {
      fonte: { type: "github", project: "SF", repo: "dono/repo", assignee: "dono" },
      perfis: [],
      pessoas: [],
      dryRun: true,
      telegram: "minimal",
    });

    expect(nova.telegram).toEqual({ content: "minimal", outroCampo: 1 });
  });

  it("monta a configuração inteira sobre a atual, sem perder campos que a página não edita", () => {
    const atual = { name: "exemplo", dryRun: true, roles: { spec: { provider: "p", model: "m" } }, people: [] };

    const nova = configDoFormulario(atual, {
      fonte: { type: "github", project: "SF", repo: "dono/repo", assignee: "dono" },
      perfis: [{ nome: "PO", papel: "po" }],
      pessoas: [{ id: "po-x", perfis: ["PO"], identidades: {} }],
      dryRun: false,
    });

    expect(nova).toMatchObject({ name: "exemplo", dryRun: false, roles: atual.roles });
    expect(nova.source).toMatchObject({ type: "github" });
    expect(nova.profiles).toEqual([{ nome: "PO", papel: "po" }]);
    expect(nova.people).toEqual([{ id: "po-x", perfis: ["PO"], identidades: {} }]);
  });

  it("histórico vira uma linha por alteração, com os nomes dos campos e sem valores", () => {
    const linhas = resumoHistorico([
      { quando: "2026-11-10T12:00:00.000Z", autor: "usuario", campos: ["dryRun", "source"] },
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain("dryRun, source");
  });

  it("pessoa da forma antiga (role, sem perfis) não perde o papel ao salvar pelo formulário", () => {
    expect(
      pessoasDoFormulario([{ id: "po-antigo", role: "po", perfis: "", teams: "", jira: "", github: "", gitlab: "" }]),
    ).toEqual([{ id: "po-antigo", role: "po", perfis: [], identidades: {} }]);
  });

  it("repositórios: comando de teste vira lista de argumentos, e campos que a tela não edita são mantidos", () => {
    const original = [
      {
        path: "/a",
        prefix: "[m]",
        test: { command: ["npm", "test"], timeoutSeconds: 600 },
        format: { command: ["npx", "biome"] },
      },
    ];

    const nova = repositoriosDoFormulario(original, [
      { path: "/a", prefix: "[m]", comando: "npm run test:unit" },
      { path: "", prefix: "", comando: "" },
    ]);

    expect(nova).toEqual([
      {
        path: "/a",
        prefix: "[m]",
        test: { command: ["npm", "run", "test:unit"], timeoutSeconds: 600 },
        format: { command: ["npx", "biome"] },
      },
    ]);
  });

  it("canal escolhido na pessoa vai para a configuração; 'automático' não aparece nela", () => {
    const pessoas = pessoasDoFormulario([
      { id: "a", perfis: "", teams: "8:orgid:a", jira: "", github: "", gitlab: "", canal: "teams" },
      { id: "b", perfis: "", teams: "", jira: "", github: "", gitlab: "", canal: "" },
    ]);
    expect(pessoas[0]).toMatchObject({ canal: "teams" });
    expect(pessoas[1]).not.toHaveProperty("canal");
  });
});

describe("modo leitura da configuração de projeto (fatia 02)", () => {
  it("ao abrir, o formulário está travado e só 'Editar' aparece", () => {
    expect(estadoDoFormulario(false)).toEqual({ formularioTravado: true, editarVisivel: true, cancelarVisivel: false });
  });

  it("editando, o formulário fica liberado e aparece 'Cancelar edição' no lugar de 'Editar'", () => {
    expect(estadoDoFormulario(true)).toEqual({ formularioTravado: false, editarVisivel: false, cancelarVisivel: true });
  });
});

describe("cofre de credenciais na página de projeto (ticket 03)", () => {
  const cofre = [
    { nome: "jira-token", atualizadoEm: "2026-11-01T10:00:00.000Z" },
    { nome: "telegram-bot", atualizadoEm: "2026-11-02T10:00:00.000Z" },
  ];

  it("o seletor oferece sem credencial e os nomes do cofre, sem valor", () => {
    expect(opcoesDeCredenciais(cofre)).toEqual([
      { valor: "", texto: "sem credencial" },
      { valor: "jira-token", texto: "jira-token" },
      { valor: "telegram-bot", texto: "telegram-bot" },
    ]);
  });

  it("um nome salvo que saiu do cofre continua no seletor, marcado como não cadastrado", () => {
    expect(opcoesDeCredenciais(cofre, "antigo")).toContainEqual({ valor: "antigo", texto: "antigo (não cadastrada)" });
  });

  it("a linha do cofre traz nome e data, sem o valor", () => {
    const linha = linhaDaCredencial(cofre[0] as { nome: string; atualizadoEm: string });
    expect(linha).toMatch(/^jira-token · atualizada em /);
    expect(linha).not.toMatch(/TOKEN/);
  });
});

describe("provedores permitidos na página de projeto (ticket 08)", () => {
  it("texto separado por vírgula vira lista sem vazios nem repetidos", () => {
    expect(provedoresDoFormulario(" anthropic, , openai ,anthropic ")).toEqual(["anthropic", "openai"]);
    expect(provedoresDoFormulario("")).toEqual([]);
  });

  it("a configuração gravada leva a lista de provedores; sem o campo, mantém a atual", () => {
    const atual = { name: "exemplo", allowedProviders: ["anthropic"] };
    const base = { fonte: { type: "jira" }, perfis: [], pessoas: [], dryRun: false };
    expect(configDoFormulario(atual, { ...base, provedores: ["openai"] }).allowedProviders).toEqual(["openai"]);
    expect(configDoFormulario(atual, base).allowedProviders).toEqual(["anthropic"]);
  });
});
