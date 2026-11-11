import { describe, expect, it } from "vitest";
import {
  entregaParaImplementar,
  podeReavaliarCorrecoes,
  resultadoDaReavaliacao,
} from "../src/packages/tarefa/index.js";

// Regras de entrada e reavaliação da implementação: a SPEC e as correções juntas (com a contagem original), a condição
// de reavaliar sem descartar revisão em andamento, e o resultado da reavaliação.

describe("Implementação: entrada", () => {
  it("junta os tickets da SPEC com as correções e guarda a contagem original", () => {
    expect(entregaParaImplementar({ tickets: ["a", "b"] }, ["c"])).toEqual({
      tickets: ["a", "b", "c"],
      originalTicketCount: 2,
    });
  });

  it("sem correções (nulas ou vazias), mantém só os tickets da SPEC", () => {
    expect(entregaParaImplementar({ tickets: ["a"] }, null).tickets).toEqual(["a"]);
    expect(entregaParaImplementar({ tickets: ["a"] }, []).originalTicketCount).toBe(1);
  });
});

describe("Implementação: reavaliação de correções", () => {
  it("sem revisão registrada, não há o que reavaliar", () => {
    expect(podeReavaliarCorrecoes(null, "abc")).toBe(false);
    expect(podeReavaliarCorrecoes(undefined, "abc")).toBe(false);
  });

  it("revisão de outro HEAD pode ser reavaliada", () => {
    expect(podeReavaliarCorrecoes({ head: "old", status: "corrigir" }, "new")).toBe(true);
  });

  it("revisão do mesmo HEAD que já não pede correção pode ser reavaliada", () => {
    expect(podeReavaliarCorrecoes({ head: "abc", status: "aprovado" }, "abc")).toBe(true);
  });

  it("revisão do mesmo HEAD que ainda pede correção não é descartada", () => {
    expect(podeReavaliarCorrecoes({ head: "abc", status: "corrigir" }, "abc")).toBe(false);
  });
});

describe("Implementação: resultado da reavaliação", () => {
  it("veredito aprovado aprova, com o resumo da revisão como feedback", () => {
    expect(resultadoDaReavaliacao("aprovado", { summary: "tudo verde" })).toEqual({
      approved: true,
      feedback: "Review de reavaliação: tudo verde",
    });
  });

  it("qualquer outro veredito não aprova; sem resumo, diz que a evidência é insuficiente", () => {
    expect(resultadoDaReavaliacao("corrigir", null)).toEqual({
      approved: false,
      feedback: "Review de reavaliação: evidência insuficiente",
    });
    expect(resultadoDaReavaliacao(undefined, undefined).approved).toBe(false);
  });
});
