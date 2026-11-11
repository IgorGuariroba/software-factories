import { describe, expect, it } from "vitest";
import { aprovacaoVigente } from "../src/packages/spec-etapa/index.js";
import { esperaVetoAoAssumir, jaAnunciouAssumido } from "../src/packages/tarefa/index.js";

// Anúncio de "assumindo" (uma vez por card), espera de veto (só para card já em andamento) e aprovação da SPEC (vale só no
// modo em que foi dada).

describe("Assumir: anúncio e veto", () => {
  it("o anúncio já saiu para este card: não repete", () => {
    expect(jaAnunciouAssumido([{ type: "assumed", project: "sf", target: "SF-1" }], "sf", "SF-1")).toBe(true);
  });

  it("anúncio de outro card ou de outro tipo de evento não conta", () => {
    expect(jaAnunciouAssumido([{ type: "assumed", project: "sf", target: "SF-2" }], "sf", "SF-1")).toBe(false);
    expect(jaAnunciouAssumido([{ type: "progress", project: "sf", target: "SF-1" }], "sf", "SF-1")).toBe(false);
    expect(jaAnunciouAssumido([], "sf", "SF-1")).toBe(false);
  });

  it("só espera veto quando o card já estava em andamento", () => {
    expect(esperaVetoAoAssumir("in_progress")).toBe(true);
    expect(esperaVetoAoAssumir("todo")).toBe(false);
    expect(esperaVetoAoAssumir(undefined)).toBe(false);
  });
});

describe("SPEC: aprovação vigente", () => {
  it("aprovada no mesmo modo de ensaio vale", () => {
    expect(aprovacaoVigente({ specReview: "approved", specApprovedDryRun: true }, true)).toBe(true);
    expect(aprovacaoVigente({ specReview: "approved", specApprovedDryRun: false }, false)).toBe(true);
  });

  it("aprovada no ensaio não vale para a publicação real, e o inverso também", () => {
    expect(aprovacaoVigente({ specReview: "approved", specApprovedDryRun: true }, false)).toBe(false);
    expect(aprovacaoVigente({ specReview: "approved", specApprovedDryRun: false }, true)).toBe(false);
  });

  it("sem aprovação, ou em rascunho, não vale", () => {
    expect(aprovacaoVigente({ specReview: "draft", specApprovedDryRun: false }, false)).toBe(false);
    expect(aprovacaoVigente({}, false)).toBe(false);
  });
});
