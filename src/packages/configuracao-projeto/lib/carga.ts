/** O que fazer com um projeto salvo pela interface ao subir a fábrica. */
export type DecisaoCargaSalvo = "ja-no-yaml" | "invalido" | "sem-fonte" | "carregar";

/**
 * Projetos criados pela interface voltam com o estado. O YAML manda: um nome que ele já usa não é sobrescrito. Uma
 * configuração salva inválida, ou um daemon que não cria Fontes, não carrega o projeto.
 */
export function decidirCargaDoSalvo(entrada: {
  nomeNoYaml: boolean;
  salvoValido: boolean;
  podeCriarFonte: boolean;
}): DecisaoCargaSalvo {
  if (entrada.nomeNoYaml) return "ja-no-yaml";
  if (!entrada.salvoValido) return "invalido";
  if (!entrada.podeCriarFonte) return "sem-fonte";
  return "carregar";
}
