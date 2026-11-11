/**
 * Ferramenta de entrega das etapas de modelo: a fábrica não escreve nada pelo modelo. A ferramenta só encerra a rodada; quem
 * lê a entrega é a própria etapa, na transcrição.
 */
export const EXECUCAO_DE_ENTREGA = async () => ({
  output: [{ type: "text" as const, text: "Recebido." }],
  control: { terminate: true as const },
});

/** Chamada de ferramenta achada na transcrição: o nome e os argumentos que o modelo mandou. */
export interface ChamadaFerramenta {
  name: string;
  arguments: unknown;
}

/**
 * A chamada de uma das ferramentas `nomes` na rodada mais recente do modelo. A varredura vai da entrada mais nova para a
 * mais antiga e para na primeira mensagem do usuário: só vale o que o modelo respondeu a este pedido.
 */
export function chamadaDaUltimaRodada(
  itens: readonly unknown[],
  nomes: readonly string[],
): ChamadaFerramenta | undefined {
  for (const entrada of itens) {
    const mensagem = (entrada as { model?: { role?: string; content?: unknown }[] }).model?.[0];
    if (mensagem?.role === "user") break;
    if (mensagem?.role !== "assistant" || !Array.isArray(mensagem.content)) continue;
    const chamada = mensagem.content.find(
      (bloco): bloco is { type: "toolCall"; name: string; arguments: unknown } =>
        bloco?.type === "toolCall" && nomes.includes((bloco as { name: string }).name),
    );
    if (chamada) return { name: chamada.name, arguments: chamada.arguments };
  }
  return undefined;
}

/** Leitura da conversa com o contrato mínimo que a busca precisa: as entradas mais recentes. */
export interface ConversaLida {
  entries(
    order: { order: "descending" },
    limit: number,
    cursor: undefined,
    context: object,
  ): Promise<{ items: readonly unknown[] }>;
}

/**
 * A chamada de uma das ferramentas `nomes` na rodada que acabou de responder ao pedido: lê as entradas mais recentes da
 * conversa e aplica `chamadaDaUltimaRodada`. Quem chama decide o que fazer com a chamada.
 */
export async function chamadaDoPedido(
  conversa: ConversaLida,
  context: object,
  nomes: readonly string[],
): Promise<ChamadaFerramenta | undefined> {
  const recentes = await conversa.entries({ order: "descending" }, 20, undefined, context);
  return chamadaDaUltimaRodada(recentes.items, nomes);
}
