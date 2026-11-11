import { describe, expect, it } from "vitest";
import { decidirCargaDoSalvo } from "../src/packages/configuracao-projeto/index.js";
import { tarefasNovas } from "../src/packages/escalonador/index.js";
import { importacoesParaRetomar } from "../src/packages/importacao/index.js";

// Regras de carga e retomada que saíram da fábrica: o YAML manda sobre o salvo; o salvo inválido ou sem capacidade de criar
// Fonte não carrega; as importações que ficaram em `importando` voltam; e um card vira Tarefa uma só vez.

describe("Carga de projetos salvos", () => {
  it("nome que o YAML já usa vence sobre o salvo, mesmo que o salvo seja válido", () => {
    expect(decidirCargaDoSalvo({ nomeNoYaml: true, salvoValido: true, podeCriarFonte: true })).toBe("ja-no-yaml");
  });

  it("salvo inválido não carrega", () => {
    expect(decidirCargaDoSalvo({ nomeNoYaml: false, salvoValido: false, podeCriarFonte: true })).toBe("invalido");
  });

  it("sem capacidade de criar Fonte não carrega", () => {
    expect(decidirCargaDoSalvo({ nomeNoYaml: false, salvoValido: true, podeCriarFonte: false })).toBe("sem-fonte");
  });

  it("salvo válido, sem conflito e com capacidade, carrega", () => {
    expect(decidirCargaDoSalvo({ nomeNoYaml: false, salvoValido: true, podeCriarFonte: true })).toBe("carregar");
  });
});

describe("Importações ao subir", () => {
  it("só volta para a fila o que ficou em importando", () => {
    expect(
      importacoesParaRetomar({
        "1": { repoId: 1, status: "importando" },
        "2": { repoId: 2, status: "ok" },
        "3": { repoId: 3, status: "importando" },
      }),
    ).toEqual([1, 3]);
  });

  it("sem importações, não volta nada", () => {
    expect(importacoesParaRetomar(undefined)).toEqual([]);
  });
});

describe("Tarefas novas", () => {
  const item = (key: string) => ({ project: "sf", key, title: key, status: "todo", state: "todo" as const });

  it("não repete card que já virou Tarefa", () => {
    expect(tarefasNovas([item("SF-1"), item("SF-2")], ["sf/SF-1"]).map((i) => i.key)).toEqual(["SF-2"]);
  });

  it("não repete card repetido dentro do próprio lote", () => {
    expect(tarefasNovas([item("SF-1"), item("SF-1")], []).map((i) => i.key)).toEqual(["SF-1"]);
  });
});
