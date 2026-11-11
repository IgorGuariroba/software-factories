/** Tarefa como a espera de uma pessoa a enxerga: a pergunta pendente, a SPEC e a triagem aguardando decisão. */
export interface TarefaAguardandoPessoa {
  questions?: { answer: string | null }[];
  specReview?: string | null;
  triage?: { review?: string | null } | null;
  /** A pergunta que a Tarefa aguarda, se houver (ver o pacote perguntas). */
  pergunta?: unknown;
}

/**
 * A Tarefa espera uma pessoa: uma pergunta sem resposta, a SPEC em rascunho ou a triagem em rascunho. `perguntaPendente`
 * é informada pelo chamador, que a conhece pelo pacote de perguntas.
 */
export function esperaPessoa(tarefa: TarefaAguardandoPessoa, perguntaPendente: boolean): boolean {
  return perguntaPendente || tarefa.specReview === "draft" || tarefa.triage?.review === "draft";
}
