// Seleção e métricas da visão geral: sem efeitos na fila ou no daemon.
import { cardHint, isTerminal } from "./view.js";

export function matchesFilter(task, filter) {
  switch (filter) {
    case "atencao":
      return cardHint(task)?.yourTurn === true;
    case "execucao":
      return task.status === "ativa";
    case "bloqueadas":
      return task.status === "bloqueada";
    default:
      return true;
  }
}

const normalize = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");

/**
 * @template {{ title: string, key: string, project: string, status: string }} T
 * @param {T[]} tasks
 * @param {string} filter
 * @param {string} query
 * @returns {T[]}
 */
export function visibleTasks(tasks, filter, query) {
  const term = normalize(query.trim());
  return tasks.filter(
    (task) => matchesFilter(task, filter) && normalize(`${task.title} ${task.key} ${task.project}`).includes(term),
  );
}

export function workspaceCounts(tasks) {
  return Object.fromEntries(
    ["todas", "atencao", "execucao", "bloqueadas"].map((filter) => [
      filter,
      tasks.filter((task) => matchesFilter(task, filter)).length,
    ]),
  );
}

/**
 * Prioriza decisões sem alterar a ordem durável da fila.
 * @template {{ status: string }} T
 * @param {T[]} tasks
 * @returns {T[]}
 */
export function priorityTasks(tasks) {
  const rank = (task) =>
    matchesFilter(task, "atencao") ? 0 : task.status === "bloqueada" ? 1 : isTerminal(task) ? 3 : 2;
  return [...tasks].sort((a, b) => rank(a) - rank(b));
}
