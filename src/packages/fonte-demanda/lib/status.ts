/** Rótulo que carrega o status da fábrica quando a Fonte não tem um campo de status próprio: `fabrica:<status>`. */
export const STATUS_LABEL = "fabrica:";

/** Status de um card aberto sem rótulo de status. */
export const OPEN_STATUS = "aberta";

/** Status de um card fechado na Fonte. */
export const CLOSED_STATUS = "fechada";

/**
 * Status do card a partir do que a Fonte tem: fechado vence; senão, o rótulo `fabrica:<status>` define o status; sem rótulo,
 * o card está `aberta`. Fonte única da regra: GitHub, GitLab e o webhook usam esta.
 */
export function statusDoCard(entrada: { fechada: boolean; rotulos: readonly string[] }): string {
  if (entrada.fechada) return CLOSED_STATUS;
  const rotulo = entrada.rotulos.find((nome) => nome.startsWith(STATUS_LABEL));
  return rotulo ? rotulo.slice(STATUS_LABEL.length) : OPEN_STATUS;
}
