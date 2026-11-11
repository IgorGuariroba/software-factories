import { describe, expect, it } from "vitest";
import { pendingQuestion, registrarRespostaNoEstado, type TarefaRespondivel } from "../src/packages/perguntas/index.js";

// Estado das perguntas: só a última pergunta conta como pendente; responder volta a Tarefa à fila (ou à pausa, se
// pedida), e não responde de novo uma pergunta já respondida.

const tarefa = (extra: Partial<TarefaRespondivel> = {}): TarefaRespondivel => ({
  id: "p/K-1",
  status: "aguardando-humano",
  pauseRequested: false,
  questions: [
    { n: 1, answer: "antiga" },
    { n: 2, answer: null },
  ],
  ...extra,
});

describe("Perguntas: estado", () => {
  it("a pendente é a última, e só se ainda não tem resposta", () => {
    expect(pendingQuestion(tarefa())?.n).toBe(2);
    expect(
      pendingQuestion(
        tarefa({
          questions: [
            { n: 1, answer: null },
            { n: 2, answer: "ok" },
          ],
        }),
      ),
    ).toBeUndefined();
    expect(pendingQuestion({})).toBeUndefined();
  });

  it("responder devolve a Tarefa à fila", () => {
    const estado = { tasks: [tarefa()] };
    expect(registrarRespostaNoEstado(estado, "p/K-1", 2, "sim")).toBe(true);
    expect(estado.tasks[0]).toMatchObject({ status: "enfileirada" });
    expect(estado.tasks[0].questions?.[1].answer).toBe("sim");
  });

  it("com pausa pedida, responder devolve à pausa", () => {
    const estado = { tasks: [tarefa({ pauseRequested: true })] };
    registrarRespostaNoEstado(estado, "p/K-1", 2, "sim");
    expect(estado.tasks[0].status).toBe("pausada");
  });

  it("pergunta já respondida, inexistente ou Tarefa inexistente não muda nada", () => {
    const estado = { tasks: [tarefa()] };
    expect(registrarRespostaNoEstado(estado, "p/K-1", 1, "nova")).toBe(false);
    expect(registrarRespostaNoEstado(estado, "p/K-1", 9, "nova")).toBe(false);
    expect(registrarRespostaNoEstado(estado, "p/X-1", 2, "nova")).toBe(false);
    expect(estado.tasks[0].questions?.[0].answer).toBe("antiga");
  });
});

describe("Tarefa: espera de pessoa", () => {
  it("espera pessoa com pergunta pendente, SPEC em rascunho ou triagem em rascunho", async () => {
    const { esperaPessoa } = await import("../src/packages/tarefa/index.js");
    expect(esperaPessoa({ specReview: "approved" }, true)).toBe(true);
    expect(esperaPessoa({ specReview: "draft" }, false)).toBe(true);
    expect(esperaPessoa({ triage: { review: "draft" } }, false)).toBe(true);
    expect(esperaPessoa({ specReview: "approved", triage: { review: "aceitar" } }, false)).toBe(false);
  });
});
