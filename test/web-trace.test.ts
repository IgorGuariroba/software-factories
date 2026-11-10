import { describe, expect, it } from "vitest";
import { resumoDasMetricas, resumoDoPasso, rotuloEtapa, totalDaTarefa, trechoDoTexto } from "../web/trace.js";

describe("rótulos do trace", () => {
  it("nomeia cada etapa em português", () => {
    expect(rotuloEtapa("spec")).toBe("SPEC");
    expect(rotuloEtapa("triagem")).toBe("Triagem");
    expect(rotuloEtapa("review")).toBe("Review");
    expect(rotuloEtapa("implementacao")).toBe("Implementação");
    expect(rotuloEtapa("retro:spec")).toBe("Retrô spec");
  });

  it("devolve o próprio nome para uma etapa desconhecida", () => {
    expect(rotuloEtapa("outra")).toBe("outra");
  });
});

describe("resumo de cada passo", () => {
  it("chamada de tool mostra o nome da ferramenta", () => {
    expect(resumoDoPasso({ tipo: "chamada", ferramenta: "ler_arquivo", argumentos: {} })).toBe("Chamou ler_arquivo");
  });

  it("resultado com erro é sinalizado como erro", () => {
    expect(resumoDoPasso({ tipo: "resultado", ferramenta: "escrever_arquivo", resultado: "x", erro: true })).toBe(
      "Erro em escrever_arquivo",
    );
  });

  it("resultado sem erro mostra a ferramenta", () => {
    expect(resumoDoPasso({ tipo: "resultado", ferramenta: "ler_arquivo", resultado: "x", erro: false })).toBe(
      "Resultado de ler_arquivo",
    );
  });
});

describe("trecho de texto", () => {
  it("corta textos longos e marca o corte", () => {
    const longo = "a".repeat(500);
    const trecho = trechoDoTexto(longo, 100);
    expect(trecho.length).toBeLessThanOrEqual(101);
    expect(trecho.endsWith("…")).toBe(true);
  });

  it("mantém textos curtos como estão", () => {
    expect(trechoDoTexto("curto", 100)).toBe("curto");
  });
});

describe("métricas na tela do trace", () => {
  it("uma etapa sem métricas aparece como indisponível, não como zero", () => {
    expect(resumoDasMetricas(null)).toBe("Métricas indisponíveis");
  });

  it("resume tokens, chamadas, erros e duração de uma etapa", () => {
    expect(resumoDasMetricas({ tokensEntrada: 1200, tokensSaida: 300, chamadas: 4, erros: 1, duracaoMs: 65000 })).toBe(
      "1200 tokens de entrada · 300 de saída · 4 chamadas · 1 erro · 1 min 5 s",
    );
  });

  it("soma as etapas para o total da tarefa, ignorando as que não têm métricas", () => {
    const total = totalDaTarefa([
      { metricas: { tokensEntrada: 10, tokensSaida: 2, chamadas: 1, erros: 0, duracaoMs: 1000 } },
      { metricas: null },
      { metricas: { tokensEntrada: 5, tokensSaida: 1, chamadas: 2, erros: 1, duracaoMs: 2000 } },
    ]);
    expect(total).toEqual({ tokensEntrada: 15, tokensSaida: 3, chamadas: 3, erros: 1 });
  });
});
