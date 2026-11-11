/**
 * Ao aplicar uma configuração editada, a Fonte é recriada só se o tipo mudou (e a fábrica sabe criar Fontes). Mudar só os
 * campos mantém a Fonte que já existe (ADR-0017).
 */
export function recriaFonte(
  anterior: { source: { type: string } },
  nova: { source: { type: string } },
  podeCriarFonte: boolean,
): boolean {
  return anterior.source.type !== nova.source.type && podeCriarFonte;
}
