import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { expect, it } from "vitest";
import { createTeamsMcpNotifier } from "../src/teams-mcp.js";

it("não envia se o MCP não conseguir resolver o destinatário", async () => {
  const calls: string[] = [];
  const server = new Server({ name: "teams-falso", version: "1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    calls.push(request.params.name);
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "falha" }) }] };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "fabrica-teste", version: "1" });
  await client.connect(clientTransport);
  try {
    await expect(createTeamsMcpNotifier(client).send({ userId: "invalido", text: "aviso" })).rejects.toThrow(
      /teams_get_chat/,
    );
    expect(calls).toEqual(["teams_get_chat"]);
  } finally {
    await client.close();
    await server.close();
  }
});

it("resolve o chat e avisa apenas o destinatário informado pelo MCP", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const server = new Server({ name: "teams-falso", version: "1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    calls.push({ name: request.params.name, args: request.params.arguments });
    const payload =
      request.params.name === "teams_get_chat"
        ? { success: true, conversationId: "chat-do-po" }
        : { success: true, messageId: "msg-1" };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "fabrica-teste", version: "1" });
  await client.connect(clientTransport);
  try {
    const notifier = createTeamsMcpNotifier(client);
    await notifier.send({ userId: "8:orgid:po", text: "Pergunta no card PROJ-1\n\n*mensagem automatizada*" });
    expect(calls).toEqual([
      { name: "teams_get_chat", args: { userId: "8:orgid:po" } },
      {
        name: "teams_send_message",
        args: {
          conversationId: "chat-do-po",
          content: "Pergunta no card PROJ-1\n\n*mensagem automatizada*",
          contentType: "markdown",
        },
      },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});
