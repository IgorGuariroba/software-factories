/**
 * Repositórios cuja importação ficou em `importando` quando o daemon caiu: elas voltam para a fila no startup. Rodar de
 * novo não duplica nada, porque a escrita é uma só.
 */
export function importacoesParaRetomar(
  importacoes: Record<string, { repoId: number; status: string }> | undefined,
): number[] {
  return Object.values(importacoes ?? {})
    .filter((registro) => registro.status === "importando")
    .map((registro) => registro.repoId);
}
