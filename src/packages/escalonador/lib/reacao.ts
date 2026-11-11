/**
 * Reação coalescida: uma por vez, e no máximo uma pendente. Pedidos feitos enquanto uma reação roda se fundem num só,
 * que roda depois dela e vê todas as mudanças já gravadas.
 */
export function criarReacao(fazer: () => Promise<void>, parada: () => boolean) {
  let pendente = false;
  let cauda: Promise<void> = Promise.resolve();
  return {
    pedir(): void {
      if (pendente || parada()) return;
      pendente = true;
      cauda = cauda.then(async () => {
        pendente = false;
        if (parada()) return;
        await fazer();
      });
    },
    ociosa: () => cauda,
  };
}
