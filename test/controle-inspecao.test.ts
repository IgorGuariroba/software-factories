import { describe, expect, it } from "vitest";
import { decidirInspecao } from "../src/packages/controle-tarefa/index.js";

// Inspeção de card já em andamento (ADR-0013): sem repositório, veto; trabalho já mesclado que cita o card, bloqueio; senão,
// segue.

describe("Inspeção de card em andamento", () => {
  it("sem repositório que identifique o card, vale o veto (mesmo sem trabalho mesclado)", () => {
    expect(decidirInspecao({ key: "SF-1", temRepositorio: false, trabalhoMesclado: null })).toEqual({ kind: "veto" });
  });

  it("trabalho já mesclado que cita o card bloqueia, com o commit na razão", () => {
    expect(
      decidirInspecao({ key: "SF-1", temRepositorio: true, trabalhoMesclado: { sha: "abc123", subject: "fix: x" } }),
    ).toEqual({
      kind: "bloquear",
      reason: 'card já implementado: o commit abc123 ("fix: x") da branch padrão cita SF-1',
    });
  });

  it("sem trabalho mesclado, segue", () => {
    expect(decidirInspecao({ key: "SF-1", temRepositorio: true, trabalhoMesclado: undefined })).toEqual({
      kind: "seguir",
    });
  });
});
