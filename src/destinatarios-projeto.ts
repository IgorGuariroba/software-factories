import type { TeamsNotifier } from "./teams-mcp.js";

export interface OpcoesNotificadorDoProjeto {
  destinatariosPermitidos: readonly string[];
  notificador: TeamsNotifier;
  /** Canal de aviso interno; nunca deve encaminhar a pergunta ao destinatário. */
  avisar: (aviso: string) => void | Promise<void>;
}

/** Fronteira comum de autorização para os envios ao usuário e ao tech lead. */
export function criarNotificadorDoProjeto({
  destinatariosPermitidos,
  notificador,
  avisar,
}: OpcoesNotificadorDoProjeto): TeamsNotifier {
  // Copia a configuração para impedir alterações acidentais na lista original.
  const permitidos = new Set(destinatariosPermitidos.filter((id) => id.trim().length > 0));

  return {
    async send({ userId, text }) {
      // A autorização é por identidade exata e ocorre antes de acessar o transporte.
      if (!permitidos.has(userId)) {
        const aviso = `Envio bloqueado: destinatário ${JSON.stringify(userId)} não pertence à lista de pessoas do projeto.`;
        // Nem o aviso nem a exceção incluem o conteúdo da pergunta.
        try {
          await avisar(aviso);
        } finally {
          // Uma falha no canal de aviso também não pode liberar o envio.
          throw new Error(aviso);
        }
      }
      await notificador.send({ userId, text });
    },
  };
}
