import { configure, type TaskId, type Tx } from "@earendil-works/pi-durable";

/** Configuração da conversa de uma etapa, sem o modelo (que vem à parte). */
export type ConfiguracaoDaConversa = Omit<Parameters<typeof configure>[2], "model">;

/**
 * Cria, na transação, a conversa de uma etapa de modelo da Tarefa e a configura com o modelo e as ferramentas da etapa.
 * Devolve o id da conversa criada.
 */
export async function criarConversaDaTarefa(
  tx: Tx,
  taskId: TaskId,
  modelo: { provider: string; model: string },
  configuracao: ConfiguracaoDaConversa,
): Promise<Awaited<ReturnType<Tx["createConversation"]>>["id"]> {
  const conversation = await tx.createConversation({ ownership: { kind: "task", taskId } });
  await configure(tx, conversation.id, {
    ...configuracao,
    model: { provider: modelo.provider, modelId: modelo.model },
  });
  return conversation.id;
}
