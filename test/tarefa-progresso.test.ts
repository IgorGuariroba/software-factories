import { describe, expect, it } from "vitest";
import { conversasExcluidasDaSpec, deveRegistrarProgresso } from "../src/packages/tarefa/index.js";

// Regras do progresso e das conversas da SPEC: a mensagem repetida não é registrada de novo (pela última, ou pelo histórico
// quando pedido), e a SPEC nunca retoma a conversa da triagem nem as que a pessoa esqueceu.

describe("Progresso: deduplicação", () => {
  it("pela última: não repete a mensagem que acabou de ser registrada", () => {
    expect(deveRegistrarProgresso(["a", "b"], "b", false)).toBe(false);
    expect(deveRegistrarProgresso(["a", "b"], "a", false)).toBe(true);
    expect(deveRegistrarProgresso([], "a", false)).toBe(true);
  });

  it("pelo histórico: não repete nenhuma mensagem já registrada, mesmo que não seja a última", () => {
    expect(deveRegistrarProgresso(["a", "b"], "a", true)).toBe(false);
    expect(deveRegistrarProgresso(["a", "b"], "c", true)).toBe(true);
  });
});

describe("SPEC: conversas excluídas", () => {
  it("exclui a conversa da triagem e as esquecidas, como texto", () => {
    expect(conversasExcluidasDaSpec({ triageConversation: "t1", conversasEsquecidas: ["e1", "e2"] })).toEqual([
      "t1",
      "e1",
      "e2",
    ]);
  });

  it("sem triagem nem esquecidas, não exclui nada; sem tarefa, também não", () => {
    expect(conversasExcluidasDaSpec({})).toEqual([]);
    expect(conversasExcluidasDaSpec(undefined)).toEqual([]);
  });
});
