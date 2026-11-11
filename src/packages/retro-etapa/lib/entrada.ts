import type { EtapaRetro } from "./retro.js";

/** Evento que a retrô lista como incidente. As demais formas de evento não entram no texto. */
export type EventoIncidente =
  | { type: "error"; message: string }
  | { type: "blocked"; reason: string }
  | { type: string };

/** Tarefa como a entrada da retrô a enxerga: só os registros que o texto descreve. */
export interface TarefaRetrospectiva {
  attempts: number;
  questions?: { n: number; origin: string; text: string }[];
  delivery?: { spec: string; tickets: { titulo: string; aceite: string }[] } | null;
  implementation?: {
    requests?: number;
    commits: { ticket: number; phase: string }[];
    pushed?: boolean;
  } | null;
  triage?: unknown;
  review?: unknown;
  publication?: unknown;
  retros?: {
    stage: string;
    status: string;
    summary?: string | null;
    proposals?: { kind: string; title: string; description: string }[];
  }[];
}

/**
 * Texto de entrada da retrô de uma etapa. A retrô é escrita pelo modelo a partir disto: as tentativas, as perguntas, os
 * incidentes da Tarefa (`eventosDaTarefa`, já filtrados por ela) e o que a etapa produziu.
 */
export function entradaDaRetro(
  etapa: EtapaRetro,
  tarefa: TarefaRetrospectiva,
  eventosDaTarefa: EventoIncidente[],
): string {
  const incidentes = eventosDaTarefa
    .filter((e) => e.type === "error" || e.type === "blocked")
    .map((e) =>
      e.type === "error"
        ? `- erro: ${(e as { message: string }).message}`
        : `- barrada: ${(e as { reason: string }).reason}`,
    );
  const perguntas = tarefa.questions ?? [];
  const comum = [
    `Tentativas da Tarefa depois de falhas: ${tarefa.attempts}.`,
    `Perguntas ao PO: ${perguntas.length}.`,
    ...perguntas.map((q) => `- pergunta ${q.n} (${q.origin}): ${q.text}`),
    `Incidentes registrados: ${incidentes.length}.`,
    ...incidentes,
  ];
  if (etapa === "spec")
    return [
      "# Retrô da etapa SPEC (grill → SPEC → Tickets)",
      ...comum,
      "## SPEC entregue",
      tarefa.delivery?.spec ?? "(nenhuma)",
      `## Tickets (${tarefa.delivery?.tickets.length ?? 0})`,
      ...(tarefa.delivery?.tickets ?? []).map((t, i) => `${i + 1}. ${t.titulo}: ${t.aceite}`),
    ].join("\n");
  if (etapa === "implementacao") {
    const impl = tarefa.implementation;
    const commits = impl?.commits ?? [];
    return [
      "# Retrô da etapa de implementação (TDD ticket a ticket)",
      ...comum,
      `Pedidos ao implementador: ${impl?.requests ?? 0}; commits aceitos: ${commits.length}; ` +
        `pedidos recusados ou sem resposta: ${Math.max(0, (impl?.requests ?? 0) - commits.length)}.`,
      ...commits.map((c) => `- ticket ${c.ticket + 1}, fase ${c.phase}`),
      `Push da branch: ${impl?.pushed ? "feito" : "não feito"}.`,
    ].join("\n");
  }
  if (etapa === "triagem" || etapa === "review" || etapa === "mr")
    return [
      `# Retrô da etapa ${etapa}`,
      ...comum,
      JSON.stringify(etapa === "triagem" ? tarefa.triage : etapa === "review" ? tarefa.review : tarefa.publication),
    ].join("\n");
  const retros = (tarefa.retros ?? []).filter((r) => r.stage !== "tarefa");
  return [
    "# Retrô consolidada da Tarefa",
    ...comum,
    "## Retrôs das etapas",
    ...retros.flatMap((r) => [
      `### ${r.stage} (${r.status})`,
      r.summary ?? "(sem resumo)",
      ...(r.proposals ?? []).map((p) => `- [${p.kind}] ${p.title}: ${p.description}`),
    ]),
  ].join("\n");
}
