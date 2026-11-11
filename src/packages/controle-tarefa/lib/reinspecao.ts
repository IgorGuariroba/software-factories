import type { EstadoControle, PortasControle, TarefaControle } from "./portas.js";

/** Resultado da reinspeção do card: `seguir` quando a Fonte diz que a Tarefa pode seguir sem esperar o veto. */
export type ResultadoReinspecao = { kind: "seguir" } | { kind: "outro" };

/** Dependências da reinspeção: a consulta à Fonte, que pode falhar (o prazo do veto continua). */
export interface PortasReinspecao {
  inspecionar(tarefa: TarefaControle): Promise<ResultadoReinspecao>;
  avisarFalha(tarefaId: string, erro: unknown): void;
}

/**
 * Reinspeciona as Tarefas aguardando o prazo de veto. Quando a Fonte confirma que a Tarefa pode seguir, o prazo encerra
 * agora e o portão é aberto. Uma falha da consulta só é registrada: o prazo continua valendo.
 */
export async function reinspecionarVetos(portas: PortasControle & PortasReinspecao): Promise<void> {
  const agora = portas.agora();
  const aguardando = await portas.alterar((estado: EstadoControle) =>
    estado.tasks.filter((t) => t.status === "aguardando-veto" && t.veto && !t.veto.expired && agora < t.veto.until),
  );
  for (const tarefa of aguardando) {
    let resultado: ResultadoReinspecao;
    try {
      resultado = await portas.inspecionar(tarefa);
    } catch (erro) {
      portas.avisarFalha(tarefa.id, erro);
      continue;
    }
    if (resultado.kind !== "seguir") continue;
    const portao = await portas.alterar((estado: EstadoControle) => {
      const atual = estado.tasks.find((t) => t.id === tarefa.id);
      if (atual?.status !== "aguardando-veto" || !atual.veto) return null;
      atual.veto.until = portas.agora();
      return atual.gateId;
    });
    if (portao !== null) await portas.abortar(portao);
  }
}
