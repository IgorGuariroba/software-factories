/** Janela de silêncio depois da qual o cursor do Telegram é zerado (sete dias). */
export const JANELA_DE_SILENCIO_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Zera o cursor de atualizações depois de sete dias sem nenhuma: o Telegram guarda as atualizações por um tempo limitado, e
 * um cursor antigo não pode prender o recebimento. Só vale no Telegram e com cursor avançado.
 */
export function deveZerarCursor(entrada: {
  via: string;
  cursor: number;
  ultimaAtualizacao: number | undefined;
  agora: number;
}): boolean {
  return (
    entrada.via === "telegram" &&
    entrada.cursor > 0 &&
    entrada.agora - (entrada.ultimaAtualizacao ?? 0) >= JANELA_DE_SILENCIO_MS
  );
}

/** Quanto falta para a janela de silêncio se fechar, a partir da última atualização (nunca negativo). */
export function esperaAteZerarCursor(ultimaAtualizacao: number | undefined, agora: number): number {
  return Math.max(0, JANELA_DE_SILENCIO_MS - (agora - (ultimaAtualizacao ?? agora)));
}

/** A atualização já foi tratada (está antes do cursor)? Então não se executa de novo. */
export function jaTratada(atualizacaoId: number, cursor: number): boolean {
  return atualizacaoId < cursor;
}

/** Cursor depois de tratar a atualização: a próxima é a seguinte à tratada. */
export function cursorDepois(atualizacaoId: number): number {
  return atualizacaoId + 1;
}
