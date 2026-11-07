import { describe, expect, it } from "vitest";
import {
  actionsFor,
  describeEvent,
  detailStatusLabel,
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

describe("status no detalhe da Tarefa", () => {
  it("diz quem a Tarefa espera: revisão da triagem, aprovação da SPEC ou resposta a uma pergunta", () => {
    const waiting = { status: "aguardando-humano" };
    expect(detailStatusLabel({ ...waiting, triage: { review: "draft" } })).toBe("Aguardando sua revisão da triagem");
    expect(detailStatusLabel({ ...waiting, specReview: "draft" })).toBe("Aguardando sua aprovação da SPEC");
    expect(detailStatusLabel({ ...waiting, questions: [{ n: 2, answer: null }] })).toBe(
      "Aguardando resposta à pergunta 2",
    );
    expect(detailStatusLabel({ status: "ativa" })).toBe("Ativa");
  });
});

describe("pipeline e atividade na página da Tarefa", () => {
  const base = { status: "ativa", stage: "implementacao", retros: [], questions: [], publication: null, review: null };

  it("mostra as etapas do fluxo com feito, atual e pendente", async () => {
    const { pipelineSteps } = await import("../web/view.js");
    expect(pipelineSteps(base).map((s) => [s.key, s.state])).toEqual([
      ["triagem", "feito"],
      ["spec", "feito"],
      ["implementacao", "atual"],
      ["review", "pendente"],
      ["entrega", "pendente"],
      ["merge", "pendente"],
    ]);
    expect(pipelineSteps({ ...base, status: "bloqueada" }).find((s) => s.key === "implementacao")?.state).toBe(
      "bloqueado",
    );
    expect(pipelineSteps({ ...base, status: "pausada" }).find((s) => s.key === "implementacao")?.state).toBe("espera");
    expect(
      pipelineSteps({ ...base, status: "concluida", stage: "entrega", publication: { status: "merged" } }).every(
        (s) => s.state === "feito",
      ),
    ).toBe(true);
  });

  it("diz em uma frase o que a Tarefa precisa de você agora", async () => {
    const { nextAction } = await import("../web/view.js");
    expect(nextAction({ ...base, status: "pausada", retros: [{ stage: "implementacao", status: "concluida" }] })).toBe(
      "Revise a Retrô da implementação e retome a Tarefa.",
    );
    expect(nextAction({ ...base, status: "aguardando-humano", specReview: "draft" })).toBe(
      "Aprove a SPEC e os Tickets para continuar.",
    );
    expect(nextAction({ ...base, status: "bloqueada", reason: "CI falhou" })).toBe("Bloqueada: CI falhou");
    expect(nextAction({ ...base, status: "aguardando-entrega", publication: { url: "https://x/pull/1" } })).toBe(
      "PR/MR aberto; aguardando CI, comentários e o seu merge.",
    );
    expect(nextAction(base)).toBeNull();
  });

  it("pede a ação certa também a partir do resumo da lista, sem citar canal", async () => {
    const { nextAction, cardHint } = await import("../web/view.js");
    const waiting = { ...base, status: "aguardando-humano" };
    expect(nextAction({ ...waiting, triageReview: "draft" })).toBe("Revise a triagem: aceite ou recuse a issue.");
    expect(nextAction({ ...waiting, pendingQuestion: 1 })).toBe("Responda à pergunta 1 na aba Perguntas.");
    // Pergunta ainda em rascunho não tem caixa de resposta: o que falta é revisar o envio.
    expect(nextAction({ ...waiting, questions: [{ n: 2, answer: null, publication: "draft" }] })).toBe(
      "Revise a pergunta 2 antes do envio, na aba Perguntas.",
    );
    expect(cardHint({ ...waiting, specReview: "draft", reason: "erro antigo" })).toEqual({
      text: "Aprove a SPEC e os Tickets para continuar.",
      yourTurn: true,
    });
    // Esperar vaga não é a vez de quem acompanha: mostra o motivo, sem a faixa de ação.
    expect(cardHint({ ...waiting, reason: "aceita na triagem; espera vaga (maxActive)" })).toEqual({
      text: "aceita na triagem; espera vaga (maxActive)",
      yourTurn: false,
    });
    expect(cardHint({ ...base, status: "bloqueada", reason: "CI" })).toEqual({
      text: "Bloqueada: CI",
      yourTurn: false,
    });
    expect(cardHint(base)).toBeNull();
  });

  it("agrupa a atividade, mais recente primeiro, sem o vaivém de fila", async () => {
    const { activity } = await import("../web/view.js");
    const events = [
      { type: "task", status: "enfileirada", at: "1" },
      { type: "task", status: "ativa", at: "2" },
      { type: "task", status: "enfileirada", reason: "espera vaga", at: "3" },
      { type: "task", status: "ativa", at: "4" },
      { type: "progress", message: "Commit abc", at: "5" },
      { type: "write", action: "comment", target: "X", dryRun: false, at: "6" },
    ];
    expect(activity(events).map((a) => [a.at, a.kind, a.text])).toEqual([
      ["6", "escrita", "Escrita: comment em X"],
      ["5", "progresso", "Commit abc"],
      ["4", "status", "Status: Ativa"],
    ]);
  });
});

describe("quadro por etapa", () => {
  it("agrupa as tarefas nas colunas do fluxo e as encerradas no fim", async () => {
    const { boardColumns } = await import("../web/view.js");
    const tasks = [
      { id: "a", status: "aguardando-humano", stage: "triagem" },
      { id: "b", status: "ativa", stage: "implementacao" },
      { id: "c", status: "aguardando-entrega", stage: "entrega" },
      { id: "d", status: "concluida", stage: "entrega" },
      { id: "e", status: "enfileirada", stage: null },
      { id: "f", status: "pausada", stage: "assumir" },
    ];
    expect(boardColumns(tasks).map((c) => [c.key, c.tasks.map((t) => t.id)])).toEqual([
      ["triagem", ["a", "e", "f"]],
      ["spec", []],
      ["implementacao", ["b"]],
      ["review", []],
      ["entrega", ["c"]],
      ["encerradas", ["d"]],
    ]);
  });
});
