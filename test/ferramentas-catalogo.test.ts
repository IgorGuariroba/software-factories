import { describe, expect, it } from "vitest";
import {
  DISPONIVEIS_DA_ETAPA,
  FERRAMENTAS,
  FERRAMENTAS_DA_ETAPA,
  type NomeFerramenta,
  tipoDaFerramenta,
  validarFerramentas,
} from "../src/ferramentas-catalogo.js";
import { createImplementationExtension, type ImplementationDeps } from "../src/implement-stage.js";
import { RetroExtension } from "../src/retro-stage.js";
import { createReviewExtension } from "../src/review-stage.js";
import { SpecExtension } from "../src/spec-stage.js";

const nomesDe = (extension: { tools?: readonly { name: string }[] }) =>
  (extension.tools ?? []).map((t) => t.name).sort();

describe("catálogo fechado de ferramentas", () => {
  it("cada ferramenta do catálogo tem um tipo conhecido", () => {
    for (const nome of Object.keys(FERRAMENTAS) as NomeFerramenta[]) {
      expect(["leitura", "escrita", "execucao", "entrega", "pergunta"]).toContain(tipoDaFerramenta(nome));
    }
  });

  it("classifica a escrita e a execução como tipos próprios", () => {
    expect(tipoDaFerramenta("escrever_arquivo")).toBe("escrita");
    expect(tipoDaFerramenta("rodar_testes")).toBe("execucao");
    expect(tipoDaFerramenta("ler_arquivo")).toBe("leitura");
  });

  it("rejeita nome fora do catálogo", () => {
    expect(() => validarFerramentas(["ferramenta_inventada"])).toThrow(/fora do catálogo/);
  });

  it("aceita um subconjunto válido e devolve os nomes na mesma ordem", () => {
    expect(validarFerramentas(["ler_arquivo", "rodar_testes"])).toEqual(["ler_arquivo", "rodar_testes"]);
  });

  it("não tem nome repetido numa mesma etapa", () => {
    for (const nomes of Object.values(FERRAMENTAS_DA_ETAPA)) {
      expect(new Set(nomes).size).toBe(nomes.length);
    }
  });
});

describe("etapas usam exatamente as ferramentas do catálogo", () => {
  it("SPEC", () => {
    expect(nomesDe(SpecExtension)).toEqual([...DISPONIVEIS_DA_ETAPA.spec].sort());
  });

  it("review", () => {
    const review = createReviewExtension("/nao-usado");
    expect(nomesDe(review.extension)).toEqual([...DISPONIVEIS_DA_ETAPA.review].sort());
  });

  it("implementação", () => {
    const implementacao = createImplementationExtension({} as ImplementationDeps);
    expect(nomesDe(implementacao.extension)).toEqual([...DISPONIVEIS_DA_ETAPA.implementacao].sort());
  });

  it("retrô", () => {
    expect(nomesDe(RetroExtension)).toEqual([...DISPONIVEIS_DA_ETAPA.retro].sort());
  });
});

describe("classificação de leitura e escrita por etapa", () => {
  it("a etapa de review não recebe nenhuma ferramenta de escrita ou execução", () => {
    const tipos = FERRAMENTAS_DA_ETAPA.review.map(tipoDaFerramenta);
    expect(tipos).not.toContain("escrita");
    expect(tipos).not.toContain("execucao");
  });

  it("a etapa de SPEC não escreve no repositório", () => {
    const tipos = FERRAMENTAS_DA_ETAPA.spec.map(tipoDaFerramenta);
    expect(tipos).not.toContain("escrita");
    expect(tipos).not.toContain("execucao");
  });

  it("o bash é disponível só na implementação e não faz parte do padrão", () => {
    expect(FERRAMENTAS_DA_ETAPA.implementacao).not.toContain("executar_comando");
    expect(DISPONIVEIS_DA_ETAPA.implementacao).toContain("executar_comando");
    const outras = (["spec", "review", "retro"] as const).flatMap((e) => [...DISPONIVEIS_DA_ETAPA[e]]);
    expect(outras).not.toContain("executar_comando");
  });

  it("só a implementação recebe escrita", () => {
    const etapasComEscrita = Object.entries(DISPONIVEIS_DA_ETAPA)
      .filter(([, nomes]) => nomes.some((n) => tipoDaFerramenta(n) === "escrita"))
      .map(([etapa]) => etapa);
    expect(etapasComEscrita).toEqual(["implementacao"]);
  });
});
