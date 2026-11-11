/** Veredito para uma Tarefa cujo escopo mudou no GitHub, no limite de um passo. */
export type VereditoEscopo = "seguir" | "refazer-spec" | "bloquear";

/**
 * O que fazer com uma Tarefa cujo escopo mudou: antes da SPEC (passos em `anteriores`) segue; depois dela e sem código, refaz
 * a SPEC; com a implementação iniciada, bloqueia, porque trocar a SPEC no meio dos commits deixaria o progresso
 * inconsistente, e essa decisão é do usuário.
 */
export function decidirEscopoAlterado(
  tarefa: { specDirty?: boolean | null; implementation?: unknown },
  passo: string,
  anteriores: ReadonlySet<string>,
): VereditoEscopo {
  if (!tarefa.specDirty || anteriores.has(passo)) return "seguir";
  return tarefa.implementation ? "bloquear" : "refazer-spec";
}
