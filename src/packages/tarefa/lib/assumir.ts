/** Evento de Tarefa assumida, como o anúncio o procura. */
export interface EventoAssumido {
  type: string;
  project?: string;
  target?: string;
}

/** O aviso de "assumindo" já saiu para este card? Ele sai uma vez só, mesmo que a etapa seja tentada de novo. */
export function jaAnunciouAssumido(eventos: EventoAssumido[], projeto: string, chave: string): boolean {
  return eventos.some((e) => e.type === "assumed" && e.project === projeto && e.target === chave);
}

/**
 * O card já estava em andamento quando a fábrica o assumiu? Então a Tarefa espera o prazo de veto antes de seguir
 * (ADR-0013); um card da fila, não.
 */
export function esperaVetoAoAssumir(inicio: string | null | undefined): boolean {
  return inicio === "in_progress";
}
