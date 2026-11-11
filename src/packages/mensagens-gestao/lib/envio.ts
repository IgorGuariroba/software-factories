/** O que fazer depois de uma falha ao publicar: esperar e tentar de novo, ou descartar a mensagem. */
export type DecisaoDeEnvio = { tipo: "descartar" } | { tipo: "esperar"; ms: number };

/**
 * Política de reenvio: até `maxTentativas` tentativas. Antes de cada nova tentativa espera a janela da lista de esperas
 * (a tentativa `n` usa a espera `n`); quando a lista acaba, repete a última; sem espera nenhuma, espera zero.
 */
export function aposFalhaDeEnvio(tentativa: number, maxTentativas: number, esperas: readonly number[]): DecisaoDeEnvio {
  if (tentativa >= maxTentativas) return { tipo: "descartar" };
  return { tipo: "esperar", ms: esperas[tentativa - 1] ?? esperas.at(-1) ?? 0 };
}
