import { describe, expect, it } from "vitest";
import { actionTab, canAnswerQuestion } from "../web/view.js";

describe("central web de pendências", () => {
  it("abre a pergunta pendente da M1-18 sem exigir navegação manual", () => {
    expect(actionTab({ status: "aguardando-humano", stage: "spec", questions: [{ answer: null }] })).toBe("perguntas");
    expect(actionTab({ status: "aguardando-humano", pendingQuestion: 1 })).toBe("perguntas");
  });
  it("prioriza a revisão de triagem e de SPEC", () => {
    expect(actionTab({ triage: { review: "draft" } })).toBe("spec");
    expect(actionTab({ specReview: "draft" })).toBe("spec");
  });
  it("encaminha implementação, review e merge para a entrega", () => {
    for (const stage of ["implementacao", "review", "entrega"]) expect(actionTab({ stage })).toBe("implementacao");
    expect(actionTab({ status: "aguardando-entrega" })).toBe("implementacao");
    expect(actionTab({ status: "ativa", stage: "spec" })).toBe("atividade");
  });
  it("permite resposta local de rascunho, mas nunca durante envio ou após resposta", () => {
    for (const status of ["aguardando-humano", "pausada"]) {
      for (const publication of ["draft", "sent", undefined])
        expect(canAnswerQuestion({ status }, { answer: null, publication })).toBe(true);
      expect(canAnswerQuestion({ status }, { answer: null, publication: "sending" })).toBe(false);
      expect(canAnswerQuestion({ status }, { answer: "respondida" })).toBe(false);
    }
    expect(canAnswerQuestion({ status: "cancelada" }, { answer: null })).toBe(false);
  });
});
