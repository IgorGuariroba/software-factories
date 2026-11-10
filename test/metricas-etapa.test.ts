import { describe, expect, it } from "vitest";
import { metricasDaEtapa } from "../src/metricas-etapa.js";
import type { PassoDoTrace } from "../src/trace.js";

const agente = (entrada: number, saida: number, quando: number): PassoDoTrace => ({
  tipo: "agente",
  texto: "ok",
  uso: { entrada, saida },
  quando,
});
const chamada = (quando: number): PassoDoTrace => ({
  tipo: "chamada",
  ferramenta: "ler_arquivo",
  argumentos: {},
  quando,
});
const erro = (quando: number): PassoDoTrace => ({
  tipo: "resultado",
  ferramenta: "escrever_arquivo",
  resultado: "recusado",
  erro: true,
  quando,
});

describe("métricas de uma etapa", () => {
  it("soma os tokens de entrada e de saída das respostas do agente", () => {
    const m = metricasDaEtapa([agente(100, 20, 1000), chamada(1100), agente(50, 5, 1200)]);
    expect(m).toMatchObject({ tokensEntrada: 150, tokensSaida: 25 });
  });

  it("conta as chamadas de ferramenta e os erros", () => {
    const m = metricasDaEtapa([chamada(1000), erro(1100), chamada(1200)]);
    expect(m).toMatchObject({ chamadas: 2, erros: 1 });
  });

  it("mede a duração do primeiro ao último passo com carimbo de tempo", () => {
    const m = metricasDaEtapa([chamada(1000), agente(1, 1, 4000), erro(2500)]);
    expect(m?.duracaoMs).toBe(3000);
  });

  it("uma etapa sem passos não tem métricas: fica indisponível, não zero", () => {
    expect(metricasDaEtapa([])).toBeNull();
  });

  it("uma etapa sem carimbo de tempo não inventa duração", () => {
    const m = metricasDaEtapa([{ tipo: "agente", texto: "ok", uso: { entrada: 1, saida: 1 } }]);
    expect(m?.duracaoMs).toBeNull();
  });
});
