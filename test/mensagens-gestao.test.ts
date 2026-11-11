import { describe, expect, it } from "vitest";
import { avisoJaEnfileirado } from "../src/packages/mensagens-gestao/index.js";

// Regra de duplicata dos avisos adiados: o mesmo evento não entra duas vezes na fila (mesmo tipo, instante, alvo e número);
// sem origem, vale a mesma mensagem; e um projeto diferente nunca conta como duplicata.

const fila = [
  {
    project: "sf",
    message: { text: "Lembrete" },
    source: { type: "question", at: "2026-01-01T00:00:00.000Z", target: "K-1", n: 1 },
  },
];

describe("Gestão: aviso adiado já enfileirado", () => {
  it("mesmo evento (tipo, instante, alvo e número) já está na fila", () => {
    expect(
      avisoJaEnfileirado(
        fila,
        "sf",
        { text: "outro texto" },
        { type: "question", at: "2026-01-01T00:00:00.000Z", target: "K-1", n: 1 },
      ),
    ).toBe(true);
  });

  it("evento com outro número ou outro instante é um aviso novo", () => {
    expect(
      avisoJaEnfileirado(
        fila,
        "sf",
        { text: "x" },
        { type: "question", at: "2026-01-01T00:00:00.000Z", target: "K-1", n: 2 },
      ),
    ).toBe(false);
    expect(
      avisoJaEnfileirado(
        fila,
        "sf",
        { text: "x" },
        { type: "question", at: "2026-01-02T00:00:00.000Z", target: "K-1", n: 1 },
      ),
    ).toBe(false);
  });

  it("sem origem, vale a mesma mensagem", () => {
    expect(avisoJaEnfileirado(fila, "sf", { text: "Lembrete" })).toBe(true);
    expect(avisoJaEnfileirado(fila, "sf", { text: "Outro" })).toBe(false);
  });

  it("projeto diferente nunca é duplicata", () => {
    expect(avisoJaEnfileirado(fila, "outro", { text: "Lembrete" })).toBe(false);
  });
});
