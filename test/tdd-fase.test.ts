import { describe, expect, it } from "vitest";
import { arquivosForaDaFase, julgamentoDaSuite, regraDaFase } from "../src/packages/tdd-etapa/index.js";

// Fronteira e julgamento de cada fase do TDD: a fase de teste só mexe em arquivos de teste, a de implementação não mexe neles;
// o estouro e o sinal vencem; a fase de teste exige teste vermelho; a de implementação exige suíte verde.

const ehTeste = (c: string) => c.endsWith(".test.ts");

describe("TDD: fronteira da fase", () => {
  it("fase de teste: o que não é de teste está fora", () => {
    expect(arquivosForaDaFase(["a.test.ts", "src/a.ts"], ehTeste, "teste")).toEqual(["src/a.ts"]);
  });

  it("fase de implementação: o que é de teste está fora", () => {
    expect(arquivosForaDaFase(["a.test.ts", "src/a.ts"], ehTeste, "implementacao")).toEqual(["a.test.ts"]);
  });

  it("a regra da fase diz o que pode mudar", () => {
    expect(regraDaFase("teste", ["*.test.ts"])).toContain("padrões: *.test.ts");
    expect(regraDaFase("implementacao", [])).toContain("não podem mudar");
  });
});

describe("TDD: julgamento da suíte", () => {
  it("estouro de tempo vence qualquer outra coisa", () => {
    expect(julgamentoDaSuite("teste", { timedOut: true, exitCode: 0 })).toBe("estourou");
  });

  it("sinal (sem código de saída) é interrupção", () => {
    expect(julgamentoDaSuite("implementacao", { timedOut: false, exitCode: null })).toBe("sinal");
  });

  it("fase de teste exige teste vermelho; passar é recusa", () => {
    expect(julgamentoDaSuite("teste", { timedOut: false, exitCode: 0 })).toBe("passou-na-fase-de-teste");
    expect(julgamentoDaSuite("teste", { timedOut: false, exitCode: 1 })).toBe("ok");
  });

  it("fase de implementação exige suíte verde; falhar é recusa", () => {
    expect(julgamentoDaSuite("implementacao", { timedOut: false, exitCode: 1 })).toBe("falhou-na-implementacao");
    expect(julgamentoDaSuite("implementacao", { timedOut: false, exitCode: 0 })).toBe("ok");
  });
});
