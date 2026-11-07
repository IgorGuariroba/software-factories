/** Reconhece a resposta explícita de desconhecimento, sem confundir frases resolutivas. */
export function respostaNaoSei(texto: string): boolean {
  const normalizado = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return /^(?:eu\s+)?nao\s+sei[.!?\s]*$/.test(normalizado);
}
