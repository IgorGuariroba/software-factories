import type { PassoDoTrace } from "./trace.js";

/** Agregados de uma execução de etapa, calculados a partir do trace (sem armazenamento próprio). */
export interface MetricasDaEtapa {
  tokensEntrada: number;
  tokensSaida: number;
  chamadas: number;
  erros: number;
  /** Do primeiro ao último passo com carimbo de tempo; `null` se o trace não tem carimbos. */
  duracaoMs: number | null;
}

/** Métricas de uma etapa. Sem passos, devolve `null`: a execução fica indisponível, não zero. */
export function metricasDaEtapa(passos: readonly PassoDoTrace[]): MetricasDaEtapa | null {
  if (passos.length === 0) return null;
  let tokensEntrada = 0;
  let tokensSaida = 0;
  let chamadas = 0;
  let erros = 0;
  const carimbos: number[] = [];
  for (const passo of passos) {
    if (passo.quando !== undefined) carimbos.push(passo.quando);
    if (passo.tipo === "agente" && passo.uso) {
      tokensEntrada += passo.uso.entrada;
      tokensSaida += passo.uso.saida;
    }
    if (passo.tipo === "chamada") chamadas += 1;
    if (passo.tipo === "resultado" && passo.erro) erros += 1;
  }
  const duracaoMs = carimbos.length > 0 ? Math.max(...carimbos) - Math.min(...carimbos) : null;
  return { tokensEntrada, tokensSaida, chamadas, erros, duracaoMs };
}
