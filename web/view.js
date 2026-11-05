// Apresentação pura da página: rótulos, ações disponíveis e reordenação. Sem DOM e sem rede.

const STATUS = {
  enfileirada: "Na fila",
  ativa: "Ativa",
  "aguardando-humano": "Aguardando resposta",
  "aguardando-veto": "Aguardando veto",
  pausada: "Pausada",
  concluida: "Concluída",
  cancelada: "Cancelada",
  bloqueada: "Bloqueada",
  vetada: "Vetada",
};

const STAGE = {
  assumir: "Assumir o card",
  veto: "Prazo de veto",
  spec: "Grill e SPEC",
  implementacao: "Implementação",
};

/** Status em que a Tarefa não anda mais. */
const TERMINAL = new Set(["concluida", "cancelada", "bloqueada", "vetada"]);

/** @param {string} status */
export const statusLabel = (status) => STATUS[status] ?? status;

/** @param {string | null | undefined} stage */
export const stageLabel = (stage) => (stage ? (STAGE[stage] ?? stage) : "Não começou");

/** @param {{ status: string }} task */
export const isTerminal = (task) => TERMINAL.has(task.status);

/**
 * Comandos que fazem sentido para a Tarefa agora, na ordem dos botões.
 * @param {{ status: string }} task
 * @returns {("vetar" | "pausar" | "retomar" | "cancelar")[]}
 */
export function actionsFor(task) {
  if (isTerminal(task)) return [];
  const actions = [];
  if (task.status === "aguardando-veto") actions.push("vetar");
  actions.push(task.status === "pausada" ? "retomar" : "pausar");
  actions.push("cancelar");
  return actions;
}

/**
 * Nova ordem da fila com a Tarefa `id` trocada de lugar com a vizinha não encerrada (acima, `delta = -1`; abaixo,
 * `+1`). As encerradas ficam onde estão. Sem vizinha, devolve `null`.
 * @param {{ id: string, status: string }[]} tasks
 * @param {string} id
 * @param {-1 | 1} delta
 * @returns {string[] | null}
 */
export function moveTask(tasks, id, delta) {
  const ids = tasks.map((t) => t.id);
  const from = ids.indexOf(id);
  if (from < 0) return null;
  let to = from + delta;
  while (to >= 0 && to < tasks.length && isTerminal(tasks[to])) to += delta;
  if (to < 0 || to >= tasks.length) return null;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}

/**
 * Uma linha legível de um evento da fábrica, para o histórico.
 * @param {Record<string, any>} e
 */
export function describeEvent(e) {
  switch (e.type) {
    case "task":
      return `Status: ${statusLabel(e.status)}${e.reason ? ` (${e.reason})` : ""}`;
    case "write":
      return `${e.dryRun ? "Registrada no dry-run" : "Escrita"}: ${e.action} em ${e.target}`;
    case "blocked":
      return `Barrada pelo guardrail: ${e.action} em ${e.target} (${e.reason})`;
    case "error":
      return `Erro: ${e.message}`;
    case "question":
      return `Pergunta ${e.n} a ${e.to} (${e.status}): ${e.text}`;
    case "notify":
      return `Aviso: ${e.message}`;
    case "assumed":
      return e.waitsVeto ? "Card assumido; aguarda o prazo de veto" : "Card assumido";
    case "command":
      return `Comando pelo ${e.via}: ${e.text} (${e.result})`;
    case "delivery":
      return `Mensagem descartada no ${e.via} depois de ${e.attempts} tentativas`;
    default:
      return String(e.type);
  }
}

/**
 * Situação de uma escrita registrada.
 * @param {Record<string, any>} w
 */
export const writeSituation = (w) => (w.type === "blocked" ? "barrada" : w.dryRun ? "dry-run" : "feita");
