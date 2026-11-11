import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/**
 * Chama uma ferramenta do msteams-mcp e devolve o objeto de sucesso que ela mandou no primeiro bloco de texto. Falha
 * do servidor, resposta sem texto JSON ou sem `success: true` viram erro com o nome da ferramenta.
 */
export async function chamarFerramentaTeams(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
  if (response.isError) throw new Error(`MCP Teams: falha em ${name}`);
  const part = Array.isArray(response.content) ? response.content.find((item) => item.type === "text") : undefined;
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
