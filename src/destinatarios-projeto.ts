import type { TeamsNotifier } from "./teams-mcp.js";

export interface OpcoesNotificadorDoProjeto {
  destinatariosPermitidos: readonly string[];
  notificador: TeamsNotifier;
  /** Canal interno de aviso, separado do destinatário da pergunta. */
  avisar: (aviso: string) => void | Promise<void>;
}

/** Autorização por identidade exata, compartilhada pelos canais do projeto. */
export function validarDestinatarioDoProjeto(permitidos: readonly string[], userId: string): void {
  if (!userId.trim() || !permitidos.includes(userId)) {
    throw new Error(
      `Envio bloqueado: destinatário ${JSON.stringify(userId)} não pertence à lista de pessoas do projeto.`,
    );
  }
}

/** Fronteira comum de autorização para os envios ao usuário e ao tech lead. */
export function criarNotificadorDoProjeto({
  destinatariosPermitidos,
  notificador,
  avisar,
}: OpcoesNotificadorDoProjeto): TeamsNotifier {
  const permitidos = [...destinatariosPermitidos];
  return {
    async send({ userId, text }) {
      try {
        validarDestinatarioDoProjeto(permitidos, userId);
      } catch (erro) {
        const bloqueio = erro as Error;
        try {
          await avisar(bloqueio.message);
        } finally {
          throw bloqueio;
        }
      }
      await notificador.send({ userId, text });
    },
  };
}
