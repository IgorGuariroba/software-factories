/**
 * Entrada da implementação: os tickets da SPEC seguidos das correções pendentes. `originalTicketCount` diz quantos são da
 * SPEC; o motor precisa dele para saber quais correções já foram feitas.
 */
export function entregaParaImplementar<T>(
  entrega: { tickets: T[] },
  correcoes: T[] | null | undefined,
): { tickets: T[]; originalTicketCount: number } {
  return { tickets: [...entrega.tickets, ...(correcoes ?? [])], originalTicketCount: entrega.tickets.length };
}

/**
 * Pode reavaliar as correções? Só se não há revisão, ou se a revisão registrada é de outro HEAD ou não pede correção.
 * Uma revisão em andamento sobre o mesmo HEAD precisa ser retomada, não descartada.
 */
export function podeReavaliarCorrecoes(
  revisao: { head: string; status: string } | null | undefined,
  head: string,
): boolean {
  return Boolean(revisao && (revisao.head !== head || revisao.status !== "corrigir"));
}

/** Resultado da reavaliação: aprovada se o veredito é `aprovado`, com o resumo da revisão como feedback. */
export function resultadoDaReavaliacao(
  veredito: string | undefined,
  revisao: { summary: string } | null | undefined,
): { approved: boolean; feedback: string } {
  return {
    approved: veredito === "aprovado",
    feedback: `Review de reavaliação: ${revisao?.summary ?? "evidência insuficiente"}`,
  };
}
