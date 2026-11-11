/** Origem de um aviso adiado: o evento da fábrica que o gerou (tipo, alvo, número e instante). */
export interface OrigemAviso {
  type: string;
  at?: string;
  target?: string;
  n?: number;
}

/** Aviso adiado na fila da ponte, como a regra de duplicata o enxerga. */
export interface AvisoAdiado {
  project: string;
  message: { text: string };
  source?: OrigemAviso;
}

/**
 * O aviso já está na fila? Com origem (um evento), a mesma origem conta: mesmo tipo, instante, alvo e número. Sem origem, a
 * mesma mensagem. A reconciliação no reinício usa isso para não duplicar um lembrete já enfileirado.
 */
export function avisoJaEnfileirado(
  fila: readonly AvisoAdiado[],
  projeto: string,
  mensagem: { text: string },
  origem?: OrigemAviso,
): boolean {
  return fila.some((item) => {
    if (item.project !== projeto) return false;
    if (origem && item.source) {
      return (
        item.source.type === origem.type &&
        item.source.at === origem.at &&
        item.source.target === origem.target &&
        item.source.n === origem.n
      );
    }
    return item.message.text === mensagem.text;
  });
}
