import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import type { Schema } from "@earendil-works/pi-schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AgenteDaEtapa } from "./agente-etapa-config.js";
import type { ProjectConfig, ServidorMcp } from "./config.js";
import { redactSecrets } from "./secrets.js";

const TIMEOUT_MS = 30_000;

type FerramentaMcp = { name: string; description?: string; inputSchema: unknown };

/** Abre uma conexão nova com o servidor, usa e fecha. Cada chamada é independente: sobrevive a reinícios da fábrica. */
async function comServidor<T>(servidor: ServidorMcp, uso: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "fabrica", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: servidor.comando,
    args: servidor.argumentos,
    stderr: "ignore",
  });
  try {
    await client.connect(transport, { timeout: TIMEOUT_MS });
    return await uso(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** O nome que o modelo vê: letras, números e sublinhado, com projeto e servidor, para não colidir entre projetos. */
export const nomeFerramentaMcp = (projeto: string, servidor: string, ferramenta: string): string =>
  `mcp_${projeto}_${servidor}_${ferramenta}`.replace(/[^a-zA-Z0-9_]/g, "_");

/**
 * Ferramentas MCP que uma etapa pode usar: só as tools que a configuração liberou para cada servidor. Servidor sem
 * tools liberadas não é nem iniciado. Uma tool fora da lista liberada nunca chega ao modelo, mesmo que o servidor a ofereça.
 */
export async function ferramentasMcpDaEtapa(config: ProjectConfig, agente: AgenteDaEtapa): Promise<ToolRegistration[]> {
  const registros: ToolRegistration[] = [];
  for (const { servidor, ferramentas: liberadas } of agente.mcp) {
    if (liberadas.length === 0) continue;
    const definicao = config.mcpServers?.find((s) => s.nome === servidor);
    if (!definicao) throw new Error(`servidor MCP ${servidor} não está cadastrado no projeto`);
    const listadas = (await comServidor(definicao, (client) => client.listTools())).tools as FerramentaMcp[];
    for (const ferramenta of listadas) {
      if (!liberadas.includes(ferramenta.name)) continue;
      registros.push(
        defineTool({
          name: nomeFerramentaMcp(config.name, servidor, ferramenta.name),
          description: ferramenta.description ?? ferramenta.name,
          parameters: ferramenta.inputSchema as Schema,
          execute: async (args) => {
            const resposta = await comServidor(definicao, (client) =>
              client.callTool({ name: ferramenta.name, arguments: args as Record<string, unknown> }),
            );
            const texto = redactSecrets(
              (resposta.content as { type?: string; text?: string }[])
                .filter((b) => b.type === "text" && typeof b.text === "string")
                .map((b) => b.text)
                .join("\n"),
            );
            if (resposta.isError) throw new Error(texto || `a ferramenta ${ferramenta.name} falhou`);
            return { output: [{ type: "text" as const, text: texto }] };
          },
        }),
      );
    }
  }
  return registros;
}
