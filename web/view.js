// Apresentação pura da página: rótulos, ações disponíveis e reordenação. Sem DOM e sem rede.

/** @param {{sha: string, ticket: number, phase: string}} commit */
export const formatCommit = (commit) => `${commit.sha.slice(0, 8)} (ticket ${commit.ticket + 1}, ${commit.phase}) `;

/** @template T
 * @param {{project: string, key: string}} selection
 * @param {() => {project: string, key: string} | null} current
 * @param {(project: string, key: string) => Promise<T>} get
 * @param {(value: T) => void} render
 * @param {(error: unknown) => void} onError
 */
export async function refreshSelectedDetail(selection, current, get, render, onError) {
  try {
    const value = await get(selection.project, selection.key);
    if (current() === selection) render(value);
  } catch (error) {
    if (current() === selection) onError(error);
  }
}

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
  "aguardando-entrega": "Aguardando merge humano",
};

const STAGE = {
  assumir: "Assumir o card",
  veto: "Prazo de veto",
  spec: "Grill e SPEC",
  implementacao: "Implementação",
  review: "Review",
  entrega: "PR/MR e merge humano",
};

const RETRO_STAGE = {
  triagem: "Retrô da triagem",
  review: "Retrô do review",
  mr: "Retrô do PR/MR",
  spec: "Retrô da SPEC",
  implementacao: "Retrô da implementação",
  tarefa: "Retrô consolidada",
};

const RETRO_STATUS = { "em-andamento": "em andamento", concluida: "concluída", falhou: "desistiu (a tarefa seguiu)" };

const PROPOSAL_KIND = { fabrica: "Fábrica", conhecimento: "Conhecimento do projeto", "repo-time": "Repo do time" };

const PROPOSAL_STATUS = {
  "a-publicar": "a publicar",
  "issue-criada": "issue aberta",
  "mais-um": "+1 numa issue parecida",
  "ja-registrada": "já registrada numa issue",
  "dry-run": "registrada no dry-run",
  "sem-repo": "só registrada (sem repositório da fábrica)",
  bloqueada: "barrada pelo guardrail",
  pendente: "pendente de aprovação",
  avisada: "sugestão enviada a você",
};

/** @param {string} stage */
export const retroStageLabel = (stage) => RETRO_STAGE[stage] ?? stage;

/** @param {string} status */
export const retroStatusLabel = (status) => RETRO_STATUS[status] ?? status;

/** @param {{ kind: string, status: string }} p */
export const proposalLabel = (p) => `${PROPOSAL_KIND[p.kind] ?? p.kind}: ${PROPOSAL_STATUS[p.status] ?? p.status}`;

/**
 * A Tarefa de um id opaco citado numa issue da fábrica, aberta pela página como `#/retro/<id opaco>`.
 * @template {{ ref?: string | null }} T
 * @param {T[]} tasks
 * @param {string} ref
 * @returns {T | null}
 */
export const taskByRef = (tasks, ref) => tasks.find((t) => t.ref === ref) ?? null;

/** Status em que a Tarefa não anda mais. */
const TERMINAL = new Set(["concluida", "cancelada", "bloqueada", "vetada"]);

/** @param {string} status */
export const statusLabel = (status) => STATUS[status] ?? status;

/**
 * Status da Tarefa no detalhe: quem ela espera, em vez de um "Aguardando resposta" genérico.
 * @param {{status: string, triage?: {review: string | null} | null, specReview?: string | null,
 *   questions?: {n: number, answer: string | null}[]}} task
 */
export function detailStatusLabel(task) {
  if (task.status !== "aguardando-humano") return statusLabel(task.status);
  if (task.triage?.review === "draft") return "Aguardando sua revisão da triagem";
  if (task.specReview === "draft") return "Aguardando sua aprovação da SPEC";
  const pending = task.questions?.at(-1);
  if (pending && pending.answer === null) return `Aguardando resposta à pergunta ${pending.n}`;
  return statusLabel(task.status);
}

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
    case "retro":
    case "progress":
      return e.message;
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
