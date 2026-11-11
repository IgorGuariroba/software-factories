import { describe, expect, it } from "vitest";
import { findSimilarIssue, SIMILARITY_THRESHOLD, titleSimilarity } from "../src/retro-similaridade.js";

// Jaccard dos tokens do título: minúsculas, sem acentos, sem palavras vazias e sem tokens de uma letra.

describe("titleSimilarity", () => {
  it("ignora caixa, acentos, pontuação e palavras vazias", () => {
    // Tokens: {corrigir, login} nos dois (o "o" é palavra vazia): interseção 2, união 2.
    expect(titleSimilarity("Corrigir login", "corrigir o login!")).toBe(1);
  });

  it("calcula Jaccard sobre os tokens restantes", () => {
    // {criar, tela} e {criar, relatorio}: interseção 1, união 3.
    expect(titleSimilarity("Criar tela", "Criar relatório")).toBeCloseTo(1 / 3, 10);
  });

  it("título sem token útil não é parecido com nada", () => {
    expect(titleSimilarity("a o de", "qualquer coisa")).toBe(0);
  });
});

describe("findSimilarIssue", () => {
  const issue = (number: number, title: string) => ({ number, title, body: "", comments: [], url: `u${number}` });

  it("exige o limiar mínimo", () => {
    expect(SIMILARITY_THRESHOLD).toBe(0.6);
    expect(findSimilarIssue([issue(1, "Criar tela")], "Criar relatório")).toBeUndefined();
  });

  it("no empate, devolve a issue mais antiga (menor número)", () => {
    const issues = [issue(9, "Corrigir login"), issue(3, "Corrigir login")];
    expect(findSimilarIssue(issues, "corrigir o login")?.number).toBe(3);
  });
});
