/**
 * Fila serializada: uma tarefa por vez, na ordem em que foram pedidas. Buscas contam como pendentes (o timer pula um
 * tick enquanto houver uma); sincronizações não.
 */
export function criarFila() {
  let cauda: Promise<void> = Promise.resolve();
  let buscasPendentes = 0;
  return {
    executar(tarefa: () => Promise<void>, conta: boolean): Promise<void> {
      if (conta) buscasPendentes++;
      const run = cauda.then(tarefa).finally(() => {
        if (conta) buscasPendentes--;
      });
      cauda = run.catch(() => undefined);
      return run;
    },
    buscasPendentes: () => buscasPendentes,
    ociosa: () => cauda,
  };
}
