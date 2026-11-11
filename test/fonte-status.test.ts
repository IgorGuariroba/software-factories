import { describe, expect, it } from "vitest";
import { CLOSED_STATUS, OPEN_STATUS, statusDoCard } from "../src/packages/fonte-demanda/index.js";

// Status do card a partir da Fonte: fechado vence qualquer rótulo; o rótulo fabrica: define o status; sem rótulo, aberta.

describe("Fonte: status do card", () => {
  it("fechado vence o rótulo de status", () => {
    expect(statusDoCard({ fechada: true, rotulos: ["fabrica:em-andamento"] })).toBe(CLOSED_STATUS);
  });

  it("rótulo fabrica:<status> define o status", () => {
    expect(statusDoCard({ fechada: false, rotulos: ["bug", "fabrica:em-andamento"] })).toBe("em-andamento");
  });

  it("sem rótulo de status, o card está aberta", () => {
    expect(statusDoCard({ fechada: false, rotulos: ["bug"] })).toBe(OPEN_STATUS);
    expect(statusDoCard({ fechada: false, rotulos: [] })).toBe("aberta");
  });

  it("entre vários rótulos de status, vale o primeiro", () => {
    expect(statusDoCard({ fechada: false, rotulos: ["fabrica:a", "fabrica:b"] })).toBe("a");
  });
});

describe("Fonte: chave do card", () => {
  it("monta e lê a chave <projeto>-<número>", async () => {
    const { chaveDoCard, numeroDaChave } = await import("../src/packages/fonte-demanda/index.js");
    expect(chaveDoCard("SF", 42)).toBe("SF-42");
    expect(numeroDaChave("SF-42")).toBe(42);
    expect(numeroDaChave("PROJ-A-7")).toBe(7);
    expect(Number.isNaN(numeroDaChave("sem-numero"))).toBe(true);
  });
});
