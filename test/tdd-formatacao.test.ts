import { describe, expect, it } from "vitest";
import { type FatosDaFormatacao, formatacaoAceitavel } from "../src/packages/tdd-etapa/index.js";

// Fase resolvida pelo formatador: só vale com RED, HEAD avançado, árvore limpa, só commits de estilo depois do RED, caminhos
// mudados e diff sem conteúdo (só espaços). Qualquer falha recusa a aceitação.

const ESTILO = "style: formata";
const ok = (extra: Partial<FatosDaFormatacao> = {}): FatosDaFormatacao => ({
  temRed: true,
  headAvancou: true,
  arvoreLimpa: true,
  assuntos: [ESTILO],
  caminhos: ["a.test.ts"],
  diffSemEspacos: "",
  mensagemDeEstilo: ESTILO,
  ...extra,
});

describe("TDD: formatação aceita", () => {
  it("caminho feliz: só commits de estilo, só espaços mudaram", () => {
    expect(formatacaoAceitavel(ok())).toBe(true);
  });

  it("sem RED, sem avanço do HEAD ou com árvore suja, recusa", () => {
    expect(formatacaoAceitavel(ok({ temRed: false }))).toBe(false);
    expect(formatacaoAceitavel(ok({ headAvancou: false }))).toBe(false);
    expect(formatacaoAceitavel(ok({ arvoreLimpa: false }))).toBe(false);
  });

  it("um commit que não é de estilo recusa; sem commits, recusa", () => {
    expect(formatacaoAceitavel(ok({ assuntos: [ESTILO, "feat: x"] }))).toBe(false);
    expect(formatacaoAceitavel(ok({ assuntos: [] }))).toBe(false);
  });

  it("sem caminhos mudados, ou com conteúdo mudado no diff, recusa", () => {
    expect(formatacaoAceitavel(ok({ caminhos: [] }))).toBe(false);
    expect(formatacaoAceitavel(ok({ diffSemEspacos: "+ const x = 1;" }))).toBe(false);
  });
});
