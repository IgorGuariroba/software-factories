import { describe, expect, it } from "vitest";
import { recriaFonte } from "../src/packages/configuracao-projeto/index.js";

// Recriação da Fonte ao aplicar a configuração (ADR-0017): só quando o tipo muda e a fábrica sabe criar a Fonte.

describe("Configuração: recriação da Fonte", () => {
  it("troca de tipo com fábrica que cria Fontes recria a Fonte", () => {
    expect(recriaFonte({ source: { type: "jira" } }, { source: { type: "github" } }, true)).toBe(true);
  });

  it("mesmo tipo, só campos mudados: mantém a Fonte que já existe", () => {
    expect(recriaFonte({ source: { type: "jira" } }, { source: { type: "jira" } }, true)).toBe(false);
  });

  it("troca de tipo sem capacidade de criar Fonte não recria", () => {
    expect(recriaFonte({ source: { type: "jira" } }, { source: { type: "github" } }, false)).toBe(false);
  });
});
