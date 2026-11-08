/** Autorização por identidade exata, usada nos fluxos de perguntas técnicas. */
export function validarDestinatarioDoProjeto(permitidos: readonly string[], userId: string): void {
  if (!userId.trim() || !permitidos.includes(userId)) {
    throw new Error(
      `Envio bloqueado: destinatário ${JSON.stringify(userId)} não pertence à lista de pessoas do projeto.`,
    );
  }
}
