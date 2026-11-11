/**
 * A aprovação da SPEC vale para o modo em que foi dada: uma SPEC aprovada no ensaio não vale para a publicação real, e
 * vice-versa. Fora do modo, a SPEC volta a rascunho e espera a aprovação de novo.
 */
export function aprovacaoVigente(
  tarefa: { specReview?: string | null; specApprovedDryRun?: boolean | null },
  dryRun: boolean,
): boolean {
  return tarefa.specReview === "approved" && tarefa.specApprovedDryRun === dryRun;
}
