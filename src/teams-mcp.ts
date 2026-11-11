import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { chamarFerramentaTeams } from "./teams-mcp-chamada.js";

/** Porta para avisar uma pessoa no Teams, sem acesso ao corpo dos cards. */
export interface TeamsNotifier {
  send(message: { userId: string; text: string }): Promise<void>;
}

/** Adaptador do servidor msteams-mcp; o chamador é responsável pelo ciclo de vida do cliente. */
export function createTeamsMcpNotifier(client: Client): TeamsNotifier {
  const call = (name: string, args: Record<string, string>) => chamarFerramentaTeams(client, name, args);
  return {
    async send({ userId, text }) {
      const chat = await call("teams_get_chat", { userId });
      if (typeof chat.conversationId !== "string" || !chat.conversationId)
        throw new Error("MCP Teams: conversa inválida");
      await call("teams_send_message", { conversationId: chat.conversationId, content: text, contentType: "markdown" });
    },
  };
}
