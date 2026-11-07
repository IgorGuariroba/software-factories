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

const PIPELINE = [
  ["triagem", "Triagem"],
  ["spec", "Grill e SPEC"],
  ["implementacao", "Implementação (TDD)"],
  ["review", "Review"],
  ["entrega", "PR/MR"],
  ["merge", "Merge humano"],
];
/** Etapas anteriores ao fluxo que contam como a primeira etapa. */
const STAGE_INDEX = { triagem: 0, assumir: 0, veto: 0, spec: 1, implementacao: 2, review: 3, entrega: 4 };

/**
 * Etapas do fluxo com o estado de cada uma: feito, atual, espera (pausada ou aguardando você), bloqueado, pendente.
 * @param {{status: string, stage?: string | null, publication?: {status: string} | null}} task
 * @returns {{key: string, label: string, state: "feito" | "atual" | "espera" | "bloqueado" | "pendente"}[]}
 */
export function pipelineSteps(task) {
  const merged = task.publication?.status === "merged" || (task.status === "concluida" && task.stage === "entrega");
  const current = merged
    ? PIPELINE.length
    : task.status === "aguardando-entrega"
      ? 5
      : (STAGE_INDEX[task.stage ?? ""] ?? -1);
  const here =
    task.status === "bloqueada" || task.status === "cancelada" || task.status === "vetada"
      ? "bloqueado"
      : ["pausada", "aguardando-humano", "aguardando-veto", "aguardando-entrega", "enfileirada"].includes(task.status)
        ? "espera"
        : "atual";
  return PIPELINE.map(([key, label], i) => ({
    key,
    label,
    state: i < current ? "feito" : i === current ? here : "pendente",
  }));
}

/**
 * O que a Tarefa precisa de você agora, numa frase; `null` quando a fábrica está trabalhando sozinha.
 * @param {Record<string, any>} task
 * @returns {string | null}
 */
const WAITING = "Aguardando você.";

export function nextAction(task) {
  if (task.status === "bloqueada") return `Bloqueada: ${task.reason ?? "motivo não informado"}`;
  if (task.status === "aguardando-entrega") return "PR/MR aberto; aguardando CI, comentários e o seu merge.";
  if (task.status === "aguardando-veto") return "Prazo de veto em andamento: vete se não quiser que a fábrica siga.";
  if (task.status === "aguardando-humano") {
    // Aceita o detalhe da Tarefa e o resumo da lista (`triageReview`, `pendingQuestion`).
    if ((task.triage?.review ?? task.triageReview) === "draft") return "Revise a triagem: aceite ou recuse a issue.";
    if (task.specReview === "draft") return "Aprove a SPEC e os Tickets para continuar.";
    const pending = task.questions?.find((q) => q.answer === null)?.n ?? task.pendingQuestion;
    if (pending) return `Responda à pergunta ${pending} na aba Perguntas.`;
    return WAITING;
  }
  if (task.status === "pausada") {
    const retro = task.retros?.at(-1);
    return retro && retro.status === "concluida"
      ? `Revise a ${retroStageLabel(retro.stage)} e retome a Tarefa.`
      : "Pausada: retome quando quiser continuar.";
  }
  return null;
}

/**
 * Linha de destaque do cartão do quadro: a ação pendente quando é a vez de quem acompanha; senão o motivo da espera,
 * sem a faixa de ação (esperar vaga, bloqueio).
 * @param {Record<string, any>} task
 * @returns {{text: string, yourTurn: boolean} | null}
 */
export function cardHint(task) {
  const action = nextAction(task);
  if (action && action !== WAITING) return { text: action, yourTurn: task.status !== "bloqueada" };
  if (action === WAITING && task.reason) return { text: task.reason, yourTurn: false };
  return action ? { text: action, yourTurn: true } : null;
}

const ACTIVITY_KIND = {
  task: "status",
  progress: "progresso",
  write: "escrita",
  blocked: "escrita",
  error: "erro",
  question: "pergunta",
  notify: "aviso",
  retro: "retro",
};

/**
 * Atividade da Tarefa, mais recente primeiro. Mudanças de status seguidas viram só a última (o vaivém de fila
 * a cada tentativa não interessa a quem acompanha).
 * @param {Record<string, any>[]} events
 * @returns {{at: string, kind: string, text: string}[]}
 */
export function activity(events) {
  const kept = events.filter((e, i) => !(e.type === "task" && events[i + 1]?.type === "task"));
  return kept.map((e) => ({ at: e.at, kind: ACTIVITY_KIND[e.type] ?? "evento", text: describeEvent(e) })).reverse();
}

/**
 * Colunas do quadro: uma por etapa do fluxo (quem não começou fica em Triagem) e as encerradas no fim.
 * @template {{status: string, stage?: string | null}} T
 * @param {T[]} tasks
 * @returns {{key: string, label: string, tasks: T[]}[]}
 */
export function boardColumns(tasks) {
  const columns = PIPELINE.slice(0, 5).map(([key, label]) => ({ key, label, tasks: /** @type {T[]} */ ([]) }));
  const closed = { key: "encerradas", label: "Encerradas", tasks: /** @type {T[]} */ ([]) };
  for (const task of tasks) {
    if (isTerminal(task)) closed.tasks.push(task);
    else columns[STAGE_INDEX[task.stage ?? ""] ?? 0].tasks.push(task);
  }
  return [...columns, closed];
}
