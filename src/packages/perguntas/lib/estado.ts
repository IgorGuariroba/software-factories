/** Pergunta como o estado a guarda: o número e a resposta (ainda sem resposta: `null`). */
export interface PerguntaComResposta {
  n: number;
  answer: string | null;
}

/** Tarefa como a resposta a enxerga: o status, a pausa pedida e as perguntas. */
export interface TarefaRespondivel {
  id: string;
  status: string;
  pauseRequested: boolean;
  questions?: PerguntaComResposta[];
}

/** A pergunta que a Tarefa aguarda: a última, se ainda não tem resposta. */
export function pendingQuestion<Q extends PerguntaComResposta>(tarefa: { questions?: Q[] }): Q | undefined {
  const ultima = tarefa.questions?.at(-1);
  return ultima && ultima.answer === null ? ultima : undefined;
}

/**
 * Grava a resposta na pergunta e devolve a Tarefa à fila (ou à pausa, se ela foi pedida). `false` se a pergunta não existe
 * ou já tem resposta.
 */
export function registrarRespostaNoEstado<T extends TarefaRespondivel>(
  estado: { tasks: T[] },
  id: string,
  n: number,
  resposta: string,
): boolean {
  const tarefa = estado.tasks.find((t) => t.id === id);
  const pergunta = tarefa?.questions?.find((q) => q.n === n);
  if (!tarefa || !pergunta || pergunta.answer !== null) return false;
  pergunta.answer = resposta;
  if (tarefa.status === "aguardando-humano") tarefa.status = tarefa.pauseRequested ? "pausada" : "enfileirada";
  return true;
}
