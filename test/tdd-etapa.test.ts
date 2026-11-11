import { describe, expect, it } from "vitest";
import {
  MAX_RECUSAS_TDD,
  type ProgressoTdd,
  passoFeito,
  passosDoTdd,
  proximoPasso,
  recusasEsgotadas,
  registrarCommitAceito,
  registrarRecusaTdd,
} from "../src/packages/tdd-etapa/index.js";

// Regras do TDD da implementação: a ordem dos passos (RED depois GREEN de cada ticket), o que conta como feito (commit ou
// ticket verificado), o avanço com um commit aceito, a recusa que conta e o limite que bloqueia.

const novo = (): ProgressoTdd => ({
  commits: [],
  verifiedTickets: null,
  head: "h0",
  pushed: true,
  requests: 0,
  rejections: 0,
  feedback: null,
});

describe("TDD: passos", () => {
  it("ordem: teste e implementação de cada ticket, em sequência", () => {
    expect(passosDoTdd(2)).toEqual([
      { ticket: 0, phase: "teste" },
      { ticket: 0, phase: "implementacao" },
      { ticket: 1, phase: "teste" },
      { ticket: 1, phase: "implementacao" },
    ]);
    expect(passosDoTdd(0)).toEqual([]);
  });

  it("feito é commit da fase, ou ticket inteiro verificado", () => {
    const p = {
      ...novo(),
      commits: [{ ticket: 0, phase: "teste" as const, sha: "a" }],
      verifiedTickets: [{ ticket: 1 }],
    };
    expect(passoFeito(p, { ticket: 0, phase: "teste" })).toBe(true);
    expect(passoFeito(p, { ticket: 0, phase: "implementacao" })).toBe(false);
    expect(passoFeito(p, { ticket: 1, phase: "implementacao" })).toBe(true);
  });

  it("o próximo passo é o primeiro ainda não feito, e não há próximo quando tudo está feito", () => {
    const passos = passosDoTdd(1);
    expect(proximoPasso(passos, novo())).toEqual({ ticket: 0, phase: "teste" });
    const tudo = { ...novo(), commits: passos.map((s) => ({ ...s, sha: "x" })) };
    expect(proximoPasso(passos, tudo)).toBeUndefined();
  });
});

describe("TDD: commits e recusas", () => {
  it("commit aceito avança o HEAD e zera recusas e feedback", () => {
    const p = { ...novo(), rejections: 2, feedback: "falhou" };
    registrarCommitAceito(p, { ticket: 0, phase: "teste" }, "sha1");
    expect(p).toMatchObject({ head: "sha1", pushed: false, requests: 1, rejections: 0, feedback: null });
    expect(p.commits).toEqual([{ ticket: 0, phase: "teste", sha: "sha1" }]);
  });

  it("recusa conta o pedido e a recusa, guarda o feedback", () => {
    const p = novo();
    registrarRecusaTdd(p, "suíte vermelha");
    expect(p).toMatchObject({ requests: 1, rejections: 1, feedback: "suíte vermelha" });
  });

  it("o limite de recusas bloqueia exatamente no máximo", () => {
    const p = novo();
    for (let i = 0; i < MAX_RECUSAS_TDD - 1; i++) registrarRecusaTdd(p, "x");
    expect(recusasEsgotadas(p)).toBe(false);
    registrarRecusaTdd(p, "x");
    expect(recusasEsgotadas(p)).toBe(true);
  });
});
