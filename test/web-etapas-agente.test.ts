import { describe, expect, it } from "vitest";
import {
  configDoFormulario,
  etapasDoFormulario,
  servidoresMcpDoFormulario,
  skillsDoFormulario,
} from "../web/projeto-config.js";

const padrao = ["entregar_spec", "perguntar_po", "perguntar_tecnico"];

describe("etapasDoFormulario", () => {
  it("sem nada alterado, não grava etapas (o padrão embutido vale)", () => {
    expect(
      etapasDoFormulario({
        spec: { modelo: { provider: "", model: "" }, promptAdicional: "", ferramentas: padrao, padrao },
      }),
    ).toBeUndefined();
  });

  it("grava o modelo quando provedor e modelo estão preenchidos", () => {
    const saida = etapasDoFormulario({
      review: { modelo: { provider: " claude ", model: "claude-z" }, promptAdicional: "", ferramentas: [], padrao: [] },
    });
    expect(saida).toEqual({ review: { modelo: { provider: "claude", model: "claude-z" } } });
  });

  it("não grava um modelo com só um dos campos", () => {
    expect(
      etapasDoFormulario({
        review: { modelo: { provider: "claude", model: "" }, promptAdicional: "", ferramentas: [], padrao: [] },
      }),
    ).toBeUndefined();
  });

  it("grava o prompt adicional sem espaços nas pontas vazias", () => {
    expect(
      etapasDoFormulario({
        spec: { modelo: null, promptAdicional: "   ", ferramentas: padrao, padrao },
      }),
    ).toBeUndefined();
    expect(
      etapasDoFormulario({
        spec: { modelo: null, promptAdicional: "Use fatias curtas.", ferramentas: padrao, padrao },
      }),
    ).toEqual({ spec: { promptAdicional: "Use fatias curtas." } });
  });

  it("grava as ferramentas só quando diferem do padrão da etapa", () => {
    expect(
      etapasDoFormulario({
        spec: { modelo: null, promptAdicional: "", ferramentas: ["entregar_spec"], padrao },
      }),
    ).toEqual({ spec: { ferramentas: ["entregar_spec"] } });
  });

  it("desligar todas as ferramentas é uma escolha gravada, não o padrão", () => {
    expect(etapasDoFormulario({ spec: { modelo: null, promptAdicional: "", ferramentas: [], padrao } })).toEqual({
      spec: { ferramentas: [] },
    });
  });
});

describe("configDoFormulario com etapas", () => {
  const atual = { name: "P", etapas: { review: { promptAdicional: "antigo" } } };
  const base = { fonte: {}, perfis: [], pessoas: [], dryRun: true };

  it("troca as etapas quando o formulário informa etapas", () => {
    expect(configDoFormulario(atual, { ...base, etapas: { spec: { promptAdicional: "novo" } } }).etapas).toEqual({
      spec: { promptAdicional: "novo" },
    });
  });

  it("remove as etapas gravadas quando o formulário não tem nenhuma", () => {
    expect(configDoFormulario(atual, { ...base, etapas: undefined })).not.toHaveProperty("etapas");
  });

  it("mantém as etapas atuais quando o chamador não informa o campo", () => {
    expect(configDoFormulario(atual, base).etapas).toEqual({ review: { promptAdicional: "antigo" } });
  });
});

describe("skills na tela", () => {
  it("uma etapa com skills escolhidas grava só essas skills", () => {
    expect(
      etapasDoFormulario({
        spec: { modelo: null, promptAdicional: "", ferramentas: padrao, padrao, skills: ["estilo-curto"] },
      }),
    ).toEqual({ spec: { skills: ["estilo-curto"] } });
  });

  it("sem skills escolhidas, a etapa não ganha bloco de skills", () => {
    expect(
      etapasDoFormulario({
        spec: { modelo: null, promptAdicional: "", ferramentas: padrao, padrao, skills: [] },
      }),
    ).toBeUndefined();
  });

  it("o editor de skills descarta linhas vazias e tira espaços do nome", () => {
    expect(
      skillsDoFormulario([
        { nome: " estilo-curto ", descricao: "Textos", conteudo: "Frases curtas." },
        { nome: "", descricao: "", conteudo: "" },
      ]),
    ).toEqual([{ nome: "estilo-curto", descricao: "Textos", conteudo: "Frases curtas." }]);
  });

  it("configDoFormulario grava as skills do projeto quando informadas", () => {
    const saida = configDoFormulario(
      { name: "P" },
      {
        fonte: {},
        perfis: [],
        pessoas: [],
        dryRun: true,
        skills: [{ nome: "estilo-curto", conteudo: "x" }],
      },
    );
    expect(saida.skills).toEqual([{ nome: "estilo-curto", conteudo: "x" }]);
  });
});

describe("MCP na tela", () => {
  it("uma etapa com servidor MCP liberado grava o servidor e as tools liberadas", () => {
    expect(
      etapasDoFormulario({
        spec: {
          modelo: null,
          promptAdicional: "",
          ferramentas: padrao,
          padrao,
          mcp: [{ servidor: "falso", ferramentas: ["buscar_card"] }],
        },
      }),
    ).toEqual({ spec: { mcp: [{ servidor: "falso", ferramentas: ["buscar_card"] }] } });
  });

  it("um servidor sem tools liberadas não é gravado na etapa", () => {
    expect(
      etapasDoFormulario({
        spec: {
          modelo: null,
          promptAdicional: "",
          ferramentas: padrao,
          padrao,
          mcp: [{ servidor: "falso", ferramentas: [] }],
        },
      }),
    ).toEqual({ spec: { mcp: [{ servidor: "falso", ferramentas: [] }] } });
  });

  it("o editor de servidores lê nome, comando e argumentos (um por linha) e descarta linhas vazias", () => {
    expect(
      servidoresMcpDoFormulario([
        { nome: " falso ", comando: " node ", argumentos: "servidor.mjs\n  --modo x \n\n" },
        { nome: "", comando: "", argumentos: "" },
      ]),
    ).toEqual([{ nome: "falso", comando: "node", argumentos: ["servidor.mjs", "--modo x"] }]);
  });

  it("configDoFormulario grava os servidores MCP do projeto quando informados", () => {
    const saida = configDoFormulario(
      { name: "P" },
      {
        fonte: {},
        perfis: [],
        pessoas: [],
        dryRun: true,
        mcpServers: [{ nome: "falso", comando: "node", argumentos: [] }],
      },
    );
    expect(saida.mcpServers).toEqual([{ nome: "falso", comando: "node", argumentos: [] }]);
  });
});
