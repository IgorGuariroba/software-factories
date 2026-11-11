/** Chave de um card: `<projeto>-<número>`, o formato que a fábrica usa em todas as Fontes. */
export function chaveDoCard(projeto: string, numero: number): string {
  return `${projeto}-${numero}`;
}

/** Número da chave: o que vem depois do último hífen. Sem número, `NaN`: quem chama decide o que fazer com isso. */
export function numeroDaChave(chave: string): number {
  return Number(chave.slice(chave.lastIndexOf("-") + 1));
}

/** Menção de uma pessoa no comentário, no formato de texto que GitHub e GitLab reconhecem: `@id`. */
export function mencaoDePessoa(personId: string): string {
  return `@${personId}`;
}
