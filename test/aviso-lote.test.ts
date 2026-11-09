import { describe, expect, it } from "vitest";
import { type AvisoEmitido, AvisoLote } from "../src/aviso-lote.js";
import { FakeClock } from "./fakes/fake-clock.js";

const clock = () => new FakeClock("2026-11-09T12:00:00Z");

function lote(janelaMs: number, c: FakeClock) {
  const emitted: AvisoEmitido[] = [];
  const avisos = new AvisoLote({
    janelaMs,
    now: c.now,
    armTimer: (cb, ms) => c.setTimer?.(cb, ms, { background: false }) ?? (() => undefined),
    emit: async (aviso) => {
      emitted.push(aviso);
    },
  });
  return { avisos, emitted };
}

const aviso = (project: string, target: string, reason: AvisoEmitido["reason"] = "escopo-alterado") => ({
  type: "notificar" as const,
  project,
  target,
  reason,
  message: `aviso de ${target}`,
});

describe("AvisoLote: agrupamento de avisos em rajada", () => {
  it("sem janela, cada aviso sai na hora", async () => {
    const c = clock();
    const { avisos, emitted } = lote(0, c);
    await avisos.add(aviso("exemplo", "SF-1"));
    await avisos.add(aviso("exemplo", "SF-2"));
    expect(emitted.map((e) => e.target)).toEqual(["SF-1", "SF-2"]);
  });

  it("um aviso só sai como veio, depois da janela", async () => {
    const c = clock();
    const { avisos, emitted } = lote(10_000, c);
    await avisos.add(aviso("exemplo", "SF-1"));
    expect(emitted).toEqual([]);
    c.advanceTo("2026-11-09T12:00:10Z");
    await new Promise((r) => setImmediate(r));
    expect(emitted).toEqual([expect.objectContaining({ target: "SF-1", message: "aviso de SF-1" })]);
  });

  it("rajada do mesmo projeto e motivo vira um resumo com a contagem e os cards", async () => {
    const c = clock();
    const { avisos, emitted } = lote(10_000, c);
    for (const n of [1, 2, 3, 4]) await avisos.add(aviso("exemplo", `SF-${n}`));
    c.advanceTo("2026-11-09T12:00:10Z");
    await new Promise((r) => setImmediate(r));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ project: "exemplo", reason: "escopo-alterado", target: "4 cards" });
    expect(emitted[0]?.message).toContain("4 avisos");
    expect(emitted[0]?.message).toContain("SF-1, SF-2, SF-3, SF-4");
  });

  it("motivos e projetos diferentes não se misturam", async () => {
    const c = clock();
    const { avisos, emitted } = lote(10_000, c);
    await avisos.add(aviso("exemplo", "SF-1", "escopo-alterado"));
    await avisos.add(aviso("exemplo", "SF-2", "repositorio-desvinculado"));
    await avisos.add(aviso("outro", "OT-1", "escopo-alterado"));
    c.advanceTo("2026-11-09T12:00:10Z");
    await new Promise((r) => setImmediate(r));
    expect(emitted).toHaveLength(3);
    expect(emitted.map((e) => e.target).sort()).toEqual(["OT-1", "SF-1", "SF-2"]);
  });

  it("rajada que não para nunca sai depois do teto de espera", async () => {
    const c = clock();
    const { avisos, emitted } = lote(10_000, c);
    // Um aviso a cada 5 s: a janela de silêncio nunca vence, mas o teto (60 s) força a saída.
    for (let i = 0; i < 14; i++) {
      await avisos.add(aviso("exemplo", `SF-${i}`));
      c.advanceTo(new Date(c.now() + 5_000));
    }
    await new Promise((r) => setImmediate(r));
    expect(emitted.length).toBeGreaterThan(0);
  });
});
