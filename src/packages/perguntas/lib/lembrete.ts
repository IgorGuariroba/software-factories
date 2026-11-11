/** Texto do lembrete enviado à pessoa que ainda não respondeu. */
export const textoDoLembrete = (pergunta: { n: number; text: string }): string =>
  `Lembrete da pergunta ${pergunta.n}: ainda aguardo a sua resposta neste card. ${pergunta.text}`;
