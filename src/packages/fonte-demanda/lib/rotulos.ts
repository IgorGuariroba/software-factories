// Rótulos de um card, comuns a todas as Fontes: o que fica fora da fila por rótulo (ex.: épicos).

/**
 * Algum rótulo do card está na lista de ignorados? Por padrão, `epic`; sem diferenciar caixa. Um épico fica fora da fila:
 * o trabalho está nas sub-issues, cada uma na fila.
 */
export function temRotuloIgnorado(rotulos: readonly string[], ignorar: readonly string[] | undefined): boolean {
  const ignorados = new Set((ignorar ?? ["epic"]).map((l) => l.toLowerCase()));
  return rotulos.some((l) => ignorados.has(l.toLowerCase()));
}
