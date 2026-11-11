/** Etapa cuja retrô pode rodar. A etapa `tarefa` é a retrô consolidada da Tarefa: não pausa a Tarefa. */
export type EtapaRetro = "triagem" | "spec" | "implementacao" | "review" | "mr" | "tarefa";

/** Tarefa como a retrô a enxerga: só o que decide se a etapa tem o que revisar, e o que o portão grava. */
export interface TarefaRetro {
  implementation?: unknown;
  triage?: unknown;
  review?: unknown;
  publication?: unknown;
  retroHeld?: EtapaRetro[];
}

/** Dependências da retrô de uma etapa. */
export interface PortasRetro {
  /** A Tarefa, como está agora. */
  tarefa(id: string): Promise<TarefaRetro | undefined>;
  /** Roda a retrô da etapa (o modelo escreve, a fábrica revisa e propõe). */
  executar(id: string, etapa: EtapaRetro, tarefa: TarefaRetro): Promise<void>;
  /** Pausa a Tarefa antes da próxima etapa, se ainda não foi pausada para esta etapa. `true` se pausou agora. */
  pausarParaRevisao(id: string, etapa: EtapaRetro): Promise<boolean>;
  /** Avisa o usuário de que a retrô da etapa está pronta para revisão. */
  avisarPronta(projeto: string, chave: string, etapa: EtapaRetro): Promise<void>;
}

/** Tarefa e projeto da retrô. */
export interface AlvoRetro {
  id: string;
  projeto: string;
  chave: string;
}

/** A etapa tem o que revisar? A implementação que não rodou não tem retrô; as demais precisam do registro da etapa. */
function aplicavel(tarefa: TarefaRetro, etapa: EtapaRetro): boolean {
  if (etapa === "implementacao") return Boolean(tarefa.implementation);
  if (etapa === "triagem") return Boolean(tarefa.triage);
  if (etapa === "review") return Boolean(tarefa.review);
  if (etapa === "mr") return Boolean(tarefa.publication);
  return true;
}

/**
 * Retrô de uma etapa. Roda se a etapa tem o que revisar. Com `retroApproval`, a Tarefa para antes da próxima etapa até
 * a pessoa revisar: pausa uma vez por etapa e avisa. A retrô consolidada (`tarefa`) nunca pausa a Tarefa.
 */
export async function concluirRetro(
  portas: PortasRetro,
  alvo: AlvoRetro,
  etapa: EtapaRetro,
  retroApproval: boolean,
): Promise<void> {
  const tarefa = await portas.tarefa(alvo.id);
  if (!tarefa || !aplicavel(tarefa, etapa)) return;
  await portas.executar(alvo.id, etapa, tarefa);
  if (retroApproval && etapa !== "tarefa" && (await portas.pausarParaRevisao(alvo.id, etapa)))
    await portas.avisarPronta(alvo.projeto, alvo.chave, etapa);
}
