/**
 * Deve registrar esta mensagem de progresso? Não repete o que já foi dito: com `todoHistorico`, compara com todo o
 * histórico (um review recuperado não volta a aparecer); senão, só com a última mensagem.
 */
export function deveRegistrarProgresso(anteriores: string[], mensagem: string, todoHistorico: boolean): boolean {
  return todoHistorico ? !anteriores.includes(mensagem) : anteriores.at(-1) !== mensagem;
}

/** Conversas que a SPEC não pode retomar: a da triagem e as que a pessoa esqueceu. */
export function conversasExcluidasDaSpec(
  tarefa: { triageConversation?: unknown; conversasEsquecidas?: unknown[] } | undefined,
): string[] {
  const excluidas = [
    ...(tarefa?.triageConversation ? [tarefa.triageConversation] : []),
    ...(tarefa?.conversasEsquecidas ?? []),
  ];
  return excluidas.map((c) => String(c));
}
