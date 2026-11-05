import { describe, expect, it } from "vitest";
import {
  actionsFor,
  describeEvent,
  formatCommit,
  moveTask,
  proposalLabel,
  refreshSelectedDetail,
  retroStageLabel,
  stageLabel,
  taskByRef,
  writeSituation,
} from "../web/view.js";

const t = (id: string, status = "enfileirada") => ({ id, status });

describe("reordenar a fila na página", () => {
  it("troca a tarefa de lugar com a vizinha", () => {
    const tasks = [t("a"), t("b"), t("c")];

    expect(moveTask(tasks, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveTask(tasks, "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("pula as encerradas, que ficam onde estão", () => {
    const tasks = [t("a"), t("x", "concluida"), t("b"), t("y", "cancelada")];

    expect(moveTask(tasks, "b", -1)).toEqual(["b", "x", "a", "y"]);
  });

  it("não há para onde mover a primeira para cima nem a última para baixo", () => {
    const tasks = [t("a"), t("b"), t("x", "vetada")];

    expect(moveTask(tasks, "a", -1)).toBeNull();
    expect(moveTask(tasks, "b", 1)).toBeNull();
  });
});

describe("ações de cada tarefa na página", () => {
  it("vetar só aparece no prazo de veto; retomar substitui pausar numa pausada", () => {
    expect(actionsFor({ status: "aguardando-veto" })).toEqual(["vetar", "pausar", "cancelar"]);
    expect(actionsFor({ status: "ativa" })).toEqual(["pausar", "cancelar"]);
    expect(actionsFor({ status: "pausada" })).toEqual(["retomar", "cancelar"]);
  });

  it("uma tarefa encerrada não tem ações", () => {
    for (const status of ["concluida", "cancelada", "bloqueada", "vetada"]) expect(actionsFor({ status })).toEqual([]);
  });
});

describe("textos da página", () => {
  it("mostra números de ticket começando em 1, sem alterar os dados", () => {
    const commit = { sha: "1234567890", ticket: 0, phase: "teste" };
    expect(formatCommit(commit)).toBe("12345678 (ticket 1, teste) ");
    expect(commit.ticket).toBe(0);
  });
  it("etapa em pt-BR, e 'Não começou' sem etapa", () => {
    expect(stageLabel("implementacao")).toBe("Implementação");
    expect(stageLabel(null)).toBe("Não começou");
  });

  it("distingue escrita feita, registrada no dry-run e barrada", () => {
    expect(writeSituation({ type: "write", dryRun: false })).toBe("feita");
    expect(writeSituation({ type: "write", dryRun: true })).toBe("dry-run");
    expect(writeSituation({ type: "blocked" })).toBe("barrada");
    expect(describeEvent({ type: "write", dryRun: true, action: "comment", target: "PROJ-1" })).toBe(
      "Registrada no dry-run: comment em PROJ-1",
    );
  });
});

describe("seleção do detalhe", () => {
  it("ignora resposta e erro de uma requisição cuja seleção mudou", async () => {
    let selected: { project: string; key: string } | null = { project: "p", key: "1" };
    let resolve!: (value: string) => void;
    let reject!: (reason: Error) => void;
    const success = new Promise<string>((r) => {
      resolve = r;
    });
    const failure = new Promise<string>((_r, r) => {
      reject = r;
    });
    const rendered: string[] = [];
    const errors: unknown[] = [];
    const a = refreshSelectedDetail(
      selected,
      () => selected,
      () => success,
      (v: string) => rendered.push(v),
      (e: unknown) => errors.push(e),
    );
    const b = refreshSelectedDetail(
      selected,
      () => selected,
      () => failure,
      (v: string) => rendered.push(v),
      (e: unknown) => errors.push(e),
    );
    selected = { project: "p", key: "2" };
    resolve("antiga");
    reject(new Error("antigo"));
    await Promise.all([a, b]);
    expect(rendered).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("retrôs na página", () => {
  it("o link público de uma issue (#/retro/<id>) resolve a Tarefa só pelo id opaco", () => {
    const list = [
      { id: "exemplo/PROJ-1", ref: "0a1b2c3d4e5f" },
      { id: "exemplo/PROJ-2", ref: "ffffffffffff" },
    ];

    expect(taskByRef(list, "ffffffffffff")?.id).toBe("exemplo/PROJ-2");
    expect(taskByRef(list, "123456789abc")).toBeNull();
  });

  it("rótulos da retrô e das propostas em pt-BR", () => {
    expect(retroStageLabel("tarefa")).toBe("Retrô consolidada");
    expect(proposalLabel({ kind: "fabrica", status: "mais-um" })).toBe("Fábrica: +1 numa issue parecida");
    expect(proposalLabel({ kind: "repo-time", status: "avisada" })).toBe("Repo do time: sugestão enviada a você");
  });
});
