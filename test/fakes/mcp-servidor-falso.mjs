// Servidor MCP de teste (stdio): duas tools, para provar que a etapa só recebe as que foram liberadas.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "falso", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "buscar_card",
      description: "Busca um card pela chave",
      inputSchema: { type: "object", properties: { chave: { type: "string" } }, required: ["chave"] },
    },
    {
      name: "apagar_card",
      description: "Apaga um card",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: "text", text: `resultado de ${request.params.name}` }],
}));

await server.connect(new StdioServerTransport());
