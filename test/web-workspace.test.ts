import { describe, expect, it } from "vitest";
import { priorityTasks, visibleTasks, workspaceCounts } from "../web/workspace.js";

const tasks = [
  { id: "a", title: "Implementação da busca", key: "SF-1", project: "sf", status: "ativa" },
  {
    id: "b",
    title: "Decisão de negócio",
    key: "VT-2",
    project: "vetor",
    status: "aguardando-humano",
    specReview: "draft",
  },
  { id: "c", title: "Build", key: "SF-3", project: "sf", status: "bloqueada" },
  { id: "d", title: "Entrega", key: "SF-4", project: "sf", status: "concluida" },
  { id: "e", title: "Na fila", key: "SF-5", project: "sf", status: "aguardando-humano", reason: "espera vaga" },
];

describe("visão geral da interface", () => {
  it("conta as situações sem considerar espera por vaga como decisão humana", () => {
    expect(workspaceCounts(tasks)).toEqual({ todas: 5, atencao: 1, execucao: 1, bloqueadas: 1 });
    expect(workspaceCounts([])).toEqual({ todas: 0, atencao: 0, execucao: 0, bloqueadas: 0 });
  });

  it("combina filtro com busca por título, chave ou projeto, ignorando acentos e caixa", () => {
    expect(visibleTasks(tasks, "todas", "  IMPLEMENTACAO ").map((t) => t.id)).toEqual(["a"]);
    expect(visibleTasks(tasks, "atencao", "vetor").map((t) => t.id)).toEqual(["b"]);
    expect(visibleTasks(tasks, "todas", "sf-3").map((t) => t.id)).toEqual(["c"]);
    expect(visibleTasks(tasks, "execucao", "vetor")).toEqual([]);
  });

  it("prioriza pendências e bloqueios visualmente sem modificar a ordem original", () => {
    expect(priorityTasks(tasks).map((t) => t.id)).toEqual(["b", "c", "a", "e", "d"]);
    expect(tasks.map((t) => t.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});
