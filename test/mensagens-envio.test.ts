import { describe, expect, it } from "vitest";
import { aposFalhaDeEnvio } from "../src/packages/mensagens-gestao/index.js";

// Política de reenvio: descarta no limite de tentativas; espera a janela de cada tentativa; repete a última espera quando a
// lista acaba; sem lista, espera zero.

const ESPERAS = [5_000, 30_000];

describe("Envio: política de reenvio", () => {
  it("espera a janela da tentativa e, na última, descarta", () => {
    expect(aposFalhaDeEnvio(1, 3, ESPERAS)).toEqual({ tipo: "esperar", ms: 5_000 });
    expect(aposFalhaDeEnvio(2, 3, ESPERAS)).toEqual({ tipo: "esperar", ms: 30_000 });
    expect(aposFalhaDeEnvio(3, 3, ESPERAS)).toEqual({ tipo: "descartar" });
  });

  it("sem janela para a tentativa, repete a última espera", () => {
    expect(aposFalhaDeEnvio(3, 5, ESPERAS)).toEqual({ tipo: "esperar", ms: 30_000 });
  });

  it("sem lista de esperas, espera zero", () => {
    expect(aposFalhaDeEnvio(1, 3, [])).toEqual({ tipo: "esperar", ms: 0 });
  });
});

describe("Avisos adiados: despertar e disponibilidade", () => {
  it("o próximo despertar é o menor instante entre os projetos; sem avisos, nenhum", async () => {
    const { proximoDespertar, podeEnviarAgora } = await import("../src/packages/mensagens-gestao/index.js");
    const disponivel = (p: string) => (p === "a" ? 500 : 300);
    expect(proximoDespertar(["a", "b"], disponivel)).toBe(300);
    expect(proximoDespertar([], disponivel)).toBeUndefined();
    expect(podeEnviarAgora("a", 500, disponivel)).toBe(true);
    expect(podeEnviarAgora("a", 499, disponivel)).toBe(false);
  });
});

describe("Avisos adiados: texto que sai", () => {
  it("renderizado vence; sem render, o modo mínimo usa o envelope; senão, a mensagem original", async () => {
    const { textoDoAvisoAdiado } = await import("../src/packages/mensagens-gestao/index.js");
    expect(textoDoAvisoAdiado({ renderizado: true, modoMinimo: true })).toBe("renderizado");
    expect(textoDoAvisoAdiado({ renderizado: false, modoMinimo: true })).toBe("envelope-minimo");
    expect(textoDoAvisoAdiado({ renderizado: false, modoMinimo: false })).toBe("original");
  });
});
