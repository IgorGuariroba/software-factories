import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/** Porta para avisar uma pessoa no Teams, sem acesso ao corpo dos cards. */
export interface TeamsNotifier {
  send(message: { userId: string; text: string }): Promise<void>;
}

/** Adaptador do servidor msteams-mcp; o chamador é responsável pelo ciclo de vida do cliente. */
export function createTeamsMcpNotifier(client: Client): TeamsNotifier {
  async function call(name: string, args: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
    if (response.isError) throw new Error(`MCP Teams: falha em ${name}`);
    const content = response.content;
    if (!Array.isArray(content)) throw new Error(`MCP Teams: resposta inválida em ${name}`);
    const part = content.find((item) => item.type === "text");
    let data: unknown;
    try {
      data = part && typeof part.text === "string" ? JSON.parse(part.text) : undefined;
    } catch {
      throw new Error(`MCP Teams: resposta inválida em ${name}`);
    }
    if (!data || typeof data !== "object" || !("success" in data) || data.success !== true)
      throw new Error(`MCP Teams: falha em ${name}`);
    return data as Record<string, unknown>;
  }
  return {
    async send({ userId, text }) {
      const chat = await call("teams_get_chat", { userId });
      if (typeof chat.conversationId !== "string" || !chat.conversationId)
        throw new Error("MCP Teams: conversa inválida");
      await call("teams_send_message", { conversationId: chat.conversationId, content: text, contentType: "markdown" });
    },
  };
}
