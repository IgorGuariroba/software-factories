/**
 * Fatos colhidos para aceitar uma fase que o formatador resolveu sozinho: o RED registrado, o HEAD, a árvore, os assuntos dos
 * commits desde o RED, os caminhos mudados e o diff ignorando espaços.
 */
export interface FatosDaFormatacao {
  /** Há um commit de RED registrado para o ticket? */
  temRed: boolean;
  /** O HEAD já saiu do RED (há commits depois dele)? */
  headAvancou: boolean;
  /** A árvore de trabalho está limpa (sem alterações pendentes)? */
  arvoreLimpa: boolean;
  /** Assuntos dos commits depois do RED. */
  assuntos: readonly string[];
  /** Caminhos mudados entre o RED e o HEAD. */
  caminhos: readonly string[];
  /** Diff entre o RED e o HEAD ignorando espaços: vazio se o formatador só mexeu em espaços. */
  diffSemEspacos: string;
  /** Mensagem exata dos commits de estilo. */
  mensagemDeEstilo: string;
}

/**
 * Aceita a formatação como fase concluída? Só se: há RED, o HEAD avançou, a árvore está limpa, todos os commits depois do
 * RED são de estilo, houve arquivos mudados, e o diff ignorando espaços é vazio (o formatador não mexeu em conteúdo não
 * branco). A suíte verde é checada depois, pelo chamador, porque custa caro.
 */
export function formatacaoAceitavel(fatos: FatosDaFormatacao): boolean {
  return (
    fatos.temRed &&
    fatos.headAvancou &&
    fatos.arvoreLimpa &&
    fatos.assuntos.length > 0 &&
    fatos.assuntos.every((assunto) => assunto === fatos.mensagemDeEstilo) &&
    fatos.caminhos.length > 0 &&
    fatos.diffSemEspacos.trim() === ""
  );
}
