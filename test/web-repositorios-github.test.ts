import { describe, expect, it } from "vitest";
import { sugerirProjeto as sugerirNoServidor } from "../src/projetos-github.js";
import {
  estadoImportacao,
  filtrarCatalogo,
  mensagemCatalogo,
  sugerirProjeto,
  temImportacaoEmAndamento,
  textoImportacao,
  visibilidade,
} from "../web/repositorios-github.js";

const repo = (over: Record<string, unknown> = {}) => ({
  id: 1,
  nome: "dono/projeto",
  dono: "dono",
  privado: false,
  plugado: { projeto: "SF", status: "ativo" },
  importacao: null,
  ...over,
});

describe("filtrarCatalogo: a busca por nome ou dono", () => {
  const repos = [repo({ nome: "Dono/Alpha", dono: "Dono" }), repo({ nome: "outra/beta", dono: "outra" })];

  it("sem texto, mostra tudo", () => {
    expect(filtrarCatalogo(repos, "  ")).toHaveLength(2);
  });

  it("ignora caixa e casa com parte do nome ou do dono", () => {
    expect(filtrarCatalogo(repos, "ALPHA")).toEqual([repos[0]]);
    expect(filtrarCatalogo(repos, "outra")).toEqual([repos[1]]);
  });

  it("texto sem resultado devolve lista vazia", () => {
    expect(filtrarCatalogo(repos, "zzz")).toEqual([]);
  });
});

describe("visibilidade: público ou privado", () => {
  it("mostra Público e Privado conforme o repositório", () => {
    expect(visibilidade(repo({ privado: false }))).toBe("Público");
    expect(visibilidade(repo({ privado: true }))).toBe("Privado");
  });
});

describe("estadoImportacao: o que o botão faz em cada caso", () => {
  it("sem projeto, não importa e oferece criar o projeto", () => {
    const estado = estadoImportacao(repo({ plugado: null }));
    expect(estado).toMatchObject({
      rotulo: "Sem projeto",
      podeImportar: false,
      criarProjeto: true,
      rotuloBotao: "Criar projeto",
      tom: "atencao",
    });
  });

  it("repositório desplugado não importa", () => {
    expect(estadoImportacao(repo({ plugado: { projeto: "SF", status: "desativado" } }))).toMatchObject({
      rotulo: "Desplugado",
      podeImportar: false,
    });
  });

  it("nunca importado oferece 'Importar issues'", () => {
    expect(estadoImportacao(repo())).toMatchObject({
      rotulo: "Não importado",
      podeImportar: true,
      rotuloBotao: "Importar issues",
    });
  });

  it("importando desliga o botão", () => {
    expect(estadoImportacao(repo({ importacao: { status: "importando" } }))).toMatchObject({
      rotulo: "Importando…",
      podeImportar: false,
    });
  });

  it("importado oferece reimportar; erro oferece tentar de novo", () => {
    expect(estadoImportacao(repo({ importacao: { status: "ok" } }))).toMatchObject({
      tom: "ok",
      rotuloBotao: "Importar de novo",
    });
    expect(estadoImportacao(repo({ importacao: { status: "erro" } }))).toMatchObject({
      tom: "atencao",
      rotuloBotao: "Tentar de novo",
    });
  });
});

describe("textoImportacao: data, resultado e erro", () => {
  it("sem importação diz que nunca importou", () => {
    expect(textoImportacao(null)).toBe("Nunca importado.");
  });

  it("importação concluída mostra a data e a contagem por tipo", () => {
    const texto = textoImportacao({
      status: "ok",
      ultimaImportacaoEm: "2026-11-09T12:00:00.000Z",
      ultimoResultado: { criadas: 2, vinculadas: 1, atualizadas: 0, ignoradas: 3 },
    });
    expect(texto).toContain("Última importação:");
    expect(texto).toContain("2 criadas · 1 vinculadas · 0 atualizadas · 3 ignoradas");
  });

  it("repositório sem issues abertas diz isso, em vez de mostrar contagem zerada", () => {
    const texto = textoImportacao({
      status: "ok",
      ultimaImportacaoEm: "2026-11-09T12:00:00.000Z",
      ultimoResultado: { criadas: 0, vinculadas: 0, atualizadas: 0, ignoradas: 0 },
    });
    expect(texto).toContain("Nenhuma issue aberta neste repositório.");
  });

  it("erro mostra a mensagem, sem inventar causa", () => {
    expect(textoImportacao({ status: "erro", ultimoErro: "GitHub respondeu 403 em /repos/x/issues" })).toContain(
      "Falhou: GitHub respondeu 403 em /repos/x/issues",
    );
  });
});

describe("mensagemCatalogo e andamento", () => {
  it("App não configurado e falha do App têm mensagens próprias; tudo certo não tem mensagem", () => {
    expect(mensagemCatalogo({ configurado: false })).toContain("FACTORY_GITHUB_APP_ID");
    expect(mensagemCatalogo({ configurado: true, erro: "GitHub respondeu 401 em /app" })).toContain("401");
    expect(mensagemCatalogo({ configurado: true })).toBe("");
  });

  it("detecta importação em andamento, para a tela continuar consultando", () => {
    expect(temImportacaoEmAndamento([repo(), repo({ importacao: { status: "importando" } })])).toBe(true);
    expect(temImportacaoEmAndamento([repo({ importacao: { status: "ok" } })])).toBe(false);
  });
});

describe("sugerirProjeto: a sugestão da tela é a mesma do servidor", () => {
  it("nome e prefixo coincidem com src/projetos-github.ts para repositórios variados", () => {
    for (const repo of [
      "dono/software-factories",
      "dono/Meu.Projeto",
      "dono/1-api",
      "dono/a",
      "dono/x_y_z_w_v",
      "d/--ab--",
    ]) {
      expect(sugerirProjeto(repo)).toEqual(sugerirNoServidor(repo));
    }
  });

  it("sugere as iniciais das palavras como prefixo", () => {
    expect(sugerirProjeto("dono/software-factories")).toEqual({ nome: "software-factories", prefixo: "SF" });
  });
});
