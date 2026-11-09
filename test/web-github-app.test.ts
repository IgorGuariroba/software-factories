import { describe, expect, it } from "vitest";
import { alertaGithubApp, etapasGithubApp, linhasGithubApp, progressoGithubApp } from "../web/github-app.js";

const receptorLigado = { ligado: true, porta: 7431, ultimaEntregaEm: "2026-11-09T15:00:00.000Z" };
const appOk = {
  configurado: true,
  app: { id: 5685212, nome: "fabrica-igor-sf" },
  instalacoes: [{ conta: "IgorGuariroba" }],
};

describe("linhasGithubApp: o que o painel mostra", () => {
  it("receptor ligado mostra a porta; sem entrega ainda, diz que nenhuma", () => {
    const linhas = linhasGithubApp({
      receptor: { ligado: true, porta: 7431, ultimaEntregaEm: null },
      app: appOk,
      repositorios: [],
    });
    expect(linhas[0]).toMatchObject({ rotulo: "Receptor do webhook", valor: "ligado na porta 7431", tom: "ok" });
    expect(linhas[1]).toMatchObject({ rotulo: "Última entrega aplicada", valor: "nenhuma ainda" });
  });

  it("receptor desligado aparece como atenção", () => {
    const linhas = linhasGithubApp({
      receptor: { ligado: false, porta: null, ultimaEntregaEm: null },
      app: { configurado: false, instalacoes: [] },
      repositorios: [],
    });
    expect(linhas[0]).toMatchObject({ valor: "desligado", tom: "atencao" });
  });

  it("App não configurado diz qual variável falta, sem consultar nada", () => {
    const linhas = linhasGithubApp({
      receptor: receptorLigado,
      app: { configurado: false, instalacoes: [] },
      repositorios: [],
    });
    expect(linhas.find((l) => l.rotulo === "GitHub App")).toMatchObject({
      valor: expect.stringContaining("FACTORY_GITHUB_APP_ID"),
      tom: "atencao",
    });
    expect(linhas.find((l) => l.rotulo === "Instalações")).toBeUndefined();
  });

  it("falha da consulta aparece com a mensagem do erro", () => {
    const linhas = linhasGithubApp({
      receptor: receptorLigado,
      app: { configurado: true, erro: "GitHub respondeu 401 em /app", instalacoes: [] },
      repositorios: [],
    });
    expect(linhas.find((l) => l.rotulo === "GitHub App")).toMatchObject({
      valor: "consulta falhou: GitHub respondeu 401 em /app",
      tom: "atencao",
    });
  });

  it("cada repositório mostra se o App o cobre, não cobre ou se não dá para saber", () => {
    const linhas = linhasGithubApp({
      receptor: receptorLigado,
      app: appOk,
      repositorios: [
        { projeto: "a", repo: "dono/coberto", status: "ativo", coberto: true },
        { projeto: "b", repo: "dono/fora", status: "ativo", coberto: false },
        { projeto: "c", repo: "dono/duvida", status: "ativo", coberto: null },
        { projeto: "d", repo: "dono/parado", status: "desativado", coberto: null },
      ],
    });
    const porRepo = Object.fromEntries(linhas.map((l) => [l.rotulo, l]));
    expect(porRepo["dono/coberto"]).toMatchObject({ valor: "coberto pelo App", tom: "ok" });
    expect(porRepo["dono/fora"]).toMatchObject({ valor: expect.stringContaining("fora do App"), tom: "atencao" });
    expect(porRepo["dono/duvida"]).toMatchObject({ valor: "cobertura desconhecida", tom: "neutro" });
    expect(porRepo["dono/parado"]).toMatchObject({ valor: "desplugado", tom: "neutro" });
  });
});

describe("alertaGithubApp: o aviso do que deixa de chegar por webhook", () => {
  it("sem repositório fora do App, não há aviso", () => {
    expect(alertaGithubApp({ repositorios: [{ status: "ativo", coberto: true }] })).toBeUndefined();
  });

  it("um repositório fora do App gera aviso no singular e explica a busca periódica", () => {
    const texto = alertaGithubApp({ repositorios: [{ status: "ativo", coberto: false }] });
    expect(texto).toMatch(/1 repositório plugado está fora do App/);
    expect(texto).toMatch(/busca periódica/);
  });

  it("não conta repositório desplugado nem de cobertura desconhecida", () => {
    expect(
      alertaGithubApp({
        repositorios: [
          { status: "desativado", coberto: false },
          { status: "ativo", coberto: null },
        ],
      }),
    ).toBeUndefined();
  });
});

describe("etapasGithubApp: o fluxo de ligação, com o estado de cada etapa", () => {
  const painelCompleto: Parameters<typeof etapasGithubApp>[0] = {
    receptor: receptorLigado,
    app: appOk,
    repositorios: [{ projeto: "sf", repo: "dono/repo", status: "ativo", coberto: true }],
  };

  it("com tudo ligado e entregas chegando, todas as etapas estão feitas", () => {
    expect(etapasGithubApp(painelCompleto).map((e) => e.estado)).toEqual(["feito", "feito", "feito", "feito"]);
  });

  it("sem entrega ainda, a última etapa fica pendente e as anteriores seguem feitas", () => {
    const etapas = etapasGithubApp({ ...painelCompleto, receptor: { ...receptorLigado, ultimaEntregaEm: null } });
    expect(etapas.map((e) => e.estado)).toEqual(["feito", "feito", "feito", "pendente"]);
  });

  it("sem instalação, a primeira etapa fica pendente; sem consulta ao App, fica desconhecida", () => {
    const semInstalacao = etapasGithubApp({ ...painelCompleto, app: { ...appOk, instalacoes: [] } });
    expect(semInstalacao[0]?.estado).toBe("pendente");
    const semConsulta = etapasGithubApp({
      receptor: receptorLigado,
      app: { configurado: false, instalacoes: [] },
      repositorios: [{ projeto: "sf", repo: "dono/repo", status: "ativo", coberto: null }],
    });
    expect(semConsulta[0]?.estado).toBe("desconhecido");
    expect(semConsulta[2]?.estado).toBe("desconhecido");
  });

  it("receptor desligado deixa a etapa de recebimento pendente", () => {
    const etapas = etapasGithubApp({
      ...painelCompleto,
      receptor: { ligado: false, porta: null, ultimaEntregaEm: null },
    });
    expect(etapas[1]?.estado).toBe("pendente");
  });
});

describe("ação e progresso do fluxo do App", () => {
  it("quando falta instalar, a primeira etapa oferece o link de instalação do App", () => {
    const etapas = etapasGithubApp({
      receptor: receptorLigado,
      app: {
        configurado: true,
        app: { id: 5685212, slug: "fabrica-igor-sf", nome: "fabrica-igor-sf" },
        instalacoes: [],
      },
      repositorios: [],
    });
    expect(etapas[0]?.acao).toEqual({
      rotulo: "Instalar o App",
      url: "https://github.com/apps/fabrica-igor-sf/installations/new",
    });
  });

  it("sem ação quando a etapa já está feita", () => {
    const etapas = etapasGithubApp({
      receptor: receptorLigado,
      app: appOk,
      repositorios: [{ projeto: "sf", repo: "dono/repo", status: "ativo", coberto: true }],
    });
    expect(etapas[0]?.acao).toBeUndefined();
  });

  it("o progresso conta as etapas feitas", () => {
    const etapas = [{ estado: "feito" }, { estado: "feito" }, { estado: "pendente" }, { estado: "pendente" }];
    expect(progressoGithubApp(etapas)).toBe("2 de 4 etapas concluídas");
    expect(progressoGithubApp([{ estado: "feito" }])).toBe("1 de 1 etapa concluída");
  });
});
