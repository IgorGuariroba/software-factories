/**
 * Próximo instante em que algum aviso adiado fica disponível para envio: o menor entre os projetos dos avisos. Sem avisos
 * adiados, `undefined` (nada para acordar).
 */
export function proximoDespertar(
  projetos: readonly string[],
  disponivelEm: (projeto: string) => number,
): number | undefined {
  if (projetos.length === 0) return undefined;
  return Math.min(...projetos.map(disponivelEm));
}

/** O aviso adiado de um projeto pode sair agora? Só se o projeto já está disponível neste instante. */
export function podeEnviarAgora(projeto: string, agora: number, disponivelEm: (projeto: string) => number): boolean {
  return disponivelEm(projeto) <= agora;
}

/**
 * Qual texto sai para um aviso adiado: o evento renderizado de novo (se ainda tem o que mostrar); senão, o envelope mínimo
 * quando o projeto pede o modo mínimo; senão, a mensagem original guardada.
 */
export function textoDoAvisoAdiado(entrada: {
  renderizado: boolean;
  modoMinimo: boolean;
}): "renderizado" | "envelope-minimo" | "original" {
  if (entrada.renderizado) return "renderizado";
  return entrada.modoMinimo ? "envelope-minimo" : "original";
}
