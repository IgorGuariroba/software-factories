import { describe, expect, it } from "vitest";
import { createTeamsMcpConversation } from "../src/teams-conversa.js";

// Cliente MCP falso: responde às três ferramentas do msteams-mcp no formato que o servidor devolve (JSON em texto).
function fakeClient(respostas: Record<string, unknown>) {
  const chamadas: { name: string; arguments: Record<string, unknown> }[] = [];
  const client = {
    async callTool({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) {
      chamadas.push({ name, arguments: args });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, ...(respostas[name] as object) }) }] };
    },
  };
  return { client: client as never, chamadas };
}

describe("adaptador MCP da conversa Teams", () => {
  it("envia pela conversa 1:1 da pessoa e devolve o id da mensagem enviada", async () => {
    const { client, chamadas } = fakeClient({
      teams_get_chat: { conversationId: "19:abc@unq.gbl.spaces" },
      teams_send_message: { serverMessageId: "1700000000001" },
    });
    const conversa = createTeamsMcpConversation(client);

    const enviada = await conversa.send("8:orgid:maria", "Pergunta 1");

    expect(chamadas.map((c) => c.name)).toEqual(["teams_get_chat", "teams_send_message"]);
    expect(chamadas[1]?.arguments).toMatchObject({ conversationId: "19:abc@unq.gbl.spaces", content: "Pergunta 1" });
    expect(enviada).toEqual({ conversationId: "19:abc@unq.gbl.spaces", messageId: "1700000000001" });
  });

  it("lê só as respostas da pessoa depois da mensagem dada, ignorando as da própria fábrica", async () => {
    const { client, chamadas } = fakeClient({
      teams_get_thread: {
        messages: [
          { id: "1", content: "Pergunta", sender: { mri: "8:orgid:fabrica" }, isFromMe: true },
          { id: "2", content: "resposta antiga", sender: { mri: "8:orgid:maria" }, isFromMe: false },
          { id: "3", content: "Use ;", sender: { mri: "8:orgid:maria" }, isFromMe: false },
          { id: "4", content: "eco", sender: { mri: "8:orgid:fabrica" }, isFromMe: true },
        ],
      },
    });
    const conversa = createTeamsMcpConversation(client);

    const respostas = await conversa.repliesFrom("19:abc", "1", "8:orgid:maria");

    expect(chamadas[0]).toMatchObject({
      name: "teams_get_thread",
      arguments: { conversationId: "19:abc", order: "asc" },
    });
    expect(respostas).toEqual([
      { id: "2", body: "resposta antiga" },
      { id: "3", body: "Use ;" },
    ]);
  });
});
