/** Resultado da inspeção de um card que já estava em andamento (ADR-0013). */
export type ResultadoInspecao = { kind: "seguir" } | { kind: "bloquear"; reason: string } | { kind: "veto" };

/** Fatos colhidos da Fonte e do repositório antes da decisão. */
export interface FatosInspecao {
  key: string;
  /** O card tem um repositório configurado que o identifica? */
  temRepositorio: boolean;
  /** Trabalho já mesclado na branch padrão que cita o card, se houver. */
  trabalhoMesclado: { sha: string; subject: string } | null | undefined;
}

/**
 * Decide o que fazer com um card já em andamento. Sem repositório que o identifique, a fábrica não sabe onde trabalhar:
 * vale o veto. Com trabalho já mesclado citando o card, bloqueia para não implementar de novo. Sem nada disso, segue.
 */
export function decidirInspecao(fatos: FatosInspecao): ResultadoInspecao {
  if (!fatos.temRepositorio) return { kind: "veto" };
  if (!fatos.trabalhoMesclado) return { kind: "seguir" };
  return {
    kind: "bloquear",
    reason: `card já implementado: o commit ${fatos.trabalhoMesclado.sha} ("${fatos.trabalhoMesclado.subject}") da branch padrão cita ${fatos.key}`,
  };
}
