import {
  type EstadoControle,
  type PortasControle,
  type ResultadoVeto,
  type TarefaControle,
  TERMINAIS,
} from "./portas.js";

/** Pausa a Tarefa: se ainda não começou, para já; se está em andamento, para no próximo passo. */
export function pausar(portas: PortasControle, id: string): Promise<boolean> {
  return alterarTarefa(portas, id, (tarefa) => {
    if (TERMINAIS.has(tarefa.status)) return;
    tarefa.pauseRequested = true;
    if (["enfileirada", "aguardando-entrega"].includes(tarefa.status)) tarefa.status = "pausada";
  });
}

/**
 * Retoma a Tarefa. Além de tirar a pausa, destrava o bloqueio que ela tem, se a retomada sabe fazê-lo: a linha de base
 * é medida de novo, a sincronização recomeça, ou o TDD recusado ganha novas tentativas (os commits aceitos ficam).
 */
export function retomar(portas: PortasControle, id: string): Promise<boolean> {
  return alterarTarefa(portas, id, (tarefa) => {
    tarefa.pauseRequested = false;
    if (tarefa.status === "pausada") tarefa.status = "enfileirada";
    const tipo = portas.tipoDeBloqueio(tarefa);
    if (tipo === "baseline" && tarefa.implementation) {
      tarefa.implementation.baseline = null;
      reenfileirar(tarefa);
    }
    if (tipo === "base-sync" && tarefa.implementation) {
      if (tarefa.implementation.synchronization?.status === "iniciada")
        tarefa.implementation.synchronization.attempts = 0;
      reenfileirar(tarefa);
    }
    if (tipo === "tdd" && tarefa.implementation) {
      tarefa.implementation.rejections = 0;
      tarefa.implementation.feedback = null;
      reenfileirar(tarefa);
    }
  });
}

/**
 * Cancela a Tarefa. Se ela tem execução durável, a execução é abortada (fora da transação); se não, a Tarefa vira
 * `cancelada` na hora.
 */
export async function cancelar(portas: PortasControle, id: string): Promise<boolean> {
  let idDurable: number | null = null;
  const encontrada = await alterarTarefa(portas, id, (tarefa) => {
    if (TERMINAIS.has(tarefa.status)) return;
    if (tarefa.durableId !== null) idDurable = tarefa.durableId;
    else tarefa.status = "cancelada";
  });
  if (idDurable !== null) await portas.abortar(idDurable);
  return encontrada;
}

/**
 * Veta a Tarefa dentro do prazo do veto. Depois do prazo, ela já segue para as etapas e o veto não vale. Vetada, a Tarefa
 * termina sem tocar no card; o portão em que ela espera é abortado para ela acordar e terminar.
 */
export async function vetar(portas: PortasControle, id: string): Promise<ResultadoVeto> {
  let gate: number | null = null;
  const resultado = await portas.alterar<ResultadoVeto>((estado) => {
    const tarefa = estado.tasks.find((t) => t.id === id);
    if (!tarefa) return "inexistente";
    if (tarefa.status !== "aguardando-veto" || !tarefa.veto || portas.agora() >= tarefa.veto.until)
      return "fora-do-prazo";
    tarefa.status = "vetada";
    tarefa.reason = "vetada pelo usuário";
    gate = tarefa.gateId;
    tarefa.gateId = null;
    return "vetada";
  });
  if (gate !== null) await portas.abortar(gate);
  return resultado;
}

/** Pausa ou retoma o daemon. Ao retomar, as Tarefas paradas só pela pausa do daemon voltam para a fila. */
export function pausarDaemon(portas: PortasControle, paused: boolean): Promise<void> {
  return portas.alterar((estado) => {
    estado.daemonPaused = paused;
    if (!paused)
      for (const tarefa of estado.tasks)
        if (tarefa.status === "pausada" && !tarefa.pauseRequested) tarefa.status = "enfileirada";
  });
}

/** Põe as Tarefas nomeadas à frente, na ordem dada; as outras seguem atrás, como estavam. */
export function reordenar(portas: PortasControle, ids: string[]): Promise<void> {
  return portas.alterar((estado: EstadoControle) => {
    const primeiras = [...new Set(ids)]
      .map((id) => estado.tasks.find((t) => t.id === id))
      .filter((t): t is TarefaControle => t !== undefined);
    estado.tasks = [...primeiras, ...estado.tasks.filter((t) => !primeiras.includes(t))];
  });
}

function reenfileirar(tarefa: TarefaControle): void {
  tarefa.durableId = null;
  tarefa.gateId = null;
  tarefa.reason = null;
  tarefa.status = "enfileirada";
}

/** Altera uma Tarefa; devolve `false` se ela não existe. */
function alterarTarefa(portas: PortasControle, id: string, mudar: (tarefa: TarefaControle) => void): Promise<boolean> {
  return portas.alterar((estado) => {
    const tarefa = estado.tasks.find((t) => t.id === id);
    if (!tarefa) return false;
    mudar(tarefa);
    return true;
  });
}
