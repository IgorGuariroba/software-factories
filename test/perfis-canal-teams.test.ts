import { describe, expect, it } from "vitest";
import { identidadeDoCanalTeams } from "../src/packages/profiles/index.js";

// Canal Teams de uma pessoa: só existe com a pessoa, a identidade no Teams e a conversa do bot configurada.

describe("Perfis: canal Teams disponível", () => {
  it("pessoa com identidade e conversa configurada: devolve a identidade", () => {
    expect(identidadeDoCanalTeams({ identidades: { teams: "mri-1" } }, true)).toBe("mri-1");
    expect(identidadeDoCanalTeams({ teamsUserId: "mri-2" }, true)).toBe("mri-2");
  });

  it("sem conversa configurada, não há canal Teams", () => {
    expect(identidadeDoCanalTeams({ identidades: { teams: "mri-1" } }, false)).toBeUndefined();
  });

  it("pessoa inexistente ou sem identidade no Teams não tem canal", () => {
    expect(identidadeDoCanalTeams(undefined, true)).toBeUndefined();
    expect(identidadeDoCanalTeams({}, true)).toBeUndefined();
  });
});
