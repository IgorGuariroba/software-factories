import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { chamarFerramentaTeams } from "./teams-mcp-chamada.js";

/**
 * Conversa de uma pessoa no Teams (fatia 08): envia mensagens e lê as respostas dela. Porta, com um adaptador MCP.
 */
export interface TeamsConversation {
  /** Envia `text` à conversa 1:1 de `userId` (MRI). Devolve a conversa e o id da mensagem enviada. */
  send(userId: string, text: string): Promise<{ conversationId: string; messageId: string }>;
  /** Mensagens de `fromMri` na conversa, depois de `afterMessageId`, em ordem cronológica. */
  repliesFrom(conversationId: string, afterMessageId: string, fromMri: string): Promise<{ id: string; body: string }[]>;
}

/** Adaptador MCP do msteams-mcp: `teams_get_chat`, `teams_send_message` e `teams_get_thread`. */
export function createTeamsMcpConversation(client: Client): TeamsConversation {
  const call = (name: string, args: Record<string, unknown>) => chamarFerramentaTeams(client, name, args);

  return {
    async send(userId, text) {
      const chat = await call("teams_get_chat", { userId });
      if (typeof chat.conversationId !== "string" || !chat.conversationId)
        throw new Error("MCP Teams: conversa inválida");
      const sent = await call("teams_send_message", {
        conversationId: chat.conversationId,
        content: text,
        contentType: "markdown",
      });
      const messageId = sent.serverMessageId ?? sent.messageId;
      if (typeof messageId !== "string" && typeof messageId !== "number")
        throw new Error("MCP Teams: envio sem identificador de mensagem");
      return { conversationId: chat.conversationId, messageId: String(messageId) };
    },

    async repliesFrom(conversationId, afterMessageId, fromMri) {
      const thread = await call("teams_get_thread", { conversationId, order: "asc", limit: 200 });
      const messages = (thread.messages ?? []) as {
        id: string;
        content: string;
        sender?: { mri?: string };
        isFromMe?: boolean;
      }[];
      const inicio = messages.findIndex((m) => String(m.id) === afterMessageId);
      if (inicio < 0) return [];
      return messages
        .slice(inicio + 1)
        .filter((m) => !m.isFromMe && m.sender?.mri === fromMri)
        .map((m) => ({ id: String(m.id), body: m.content }));
    },
  };
}
