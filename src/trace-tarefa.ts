import type { Context } from "@earendil-works/chord/context";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import type { QueuedTask } from "./durable.js";
import { type MetricasDaEtapa, metricasDaEtapa } from "./metricas-etapa.js";
import { type PassoDoTrace, traceDaConversa } from "./trace.js";

/** O trace de uma etapa da Tarefa: a conversa do modelo naquela etapa, em ordem. */
export interface EtapaDoTrace {
  etapa: string;
  conversationId: string;
  passos: PassoDoTrace[];
  /** Agregados da execução, a partir do trace; `null` quando a etapa ainda não tem passos. */
  metricas: MetricasDaEtapa | null;
}

/** As conversas gravadas na Tarefa, cada uma com o nome da etapa. Conversa ainda não criada não aparece. */
export function conversasDaTarefa(task: QueuedTask): Map<ConversationId, string> {
  const etapaDe = new Map<ConversationId, string>();
  if (task.specConversationId) etapaDe.set(task.specConversationId, "spec");
  if (task.triageConversation) etapaDe.set(task.triageConversation, "triagem");
  if (task.review?.conversationId) etapaDe.set(task.review.conversationId, "review");
  if (task.implementation?.conversationId) etapaDe.set(task.implementation.conversationId, "implementacao");
  for (const retro of task.retros ?? []) {
    if (retro.conversationId) etapaDe.set(retro.conversationId, `retro:${retro.stage}`);
  }
  return etapaDe;
}

/** O trace de cada conversa da Tarefa, com o nome da etapa. */
export async function traceDaTarefa(harness: Harness, task: QueuedTask, context: Context): Promise<EtapaDoTrace[]> {
  const etapaDe = conversasDaTarefa(task);
  const saida: EtapaDoTrace[] = [];
  for (const [conversationId, etapa] of etapaDe) {
    const conversa = await harness.conversation(conversationId, context);
    if (!conversa) continue;
    const pagina = await conversa.entries({ order: "ascending" }, 500, undefined, context);
    const passos = traceDaConversa(pagina.items);
    saida.push({ etapa, conversationId: String(conversationId), passos, metricas: metricasDaEtapa(passos) });
  }
  return saida;
}
