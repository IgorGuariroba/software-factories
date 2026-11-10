import { describe, expect, it } from "vitest";
import { identidadeTeams } from "../src/packages/profiles/index.js";

// Fatia 08: o aviso no Teams vai para o identificador da própria pessoa; a forma antiga continua valendo.
describe("identidade no Teams por pessoa do projeto", () => {
  it("usa o identificador em identidades.teams", () => {
    expect(identidadeTeams({ identidades: { teams: "8:orgid:edgar" } })).toBe("8:orgid:edgar");
  });

  it("cai para teamsUserId da forma antiga quando não há identidades.teams", () => {
    expect(identidadeTeams({ teamsUserId: "8:orgid:velho" })).toBe("8:orgid:velho");
  });

  it("prefere identidades.teams quando as duas formas existem", () => {
    expect(identidadeTeams({ identidades: { teams: "8:orgid:novo" }, teamsUserId: "8:orgid:velho" })).toBe(
      "8:orgid:novo",
    );
  });

  it("sem identificador no Teams, não há destino", () => {
    expect(identidadeTeams({})).toBeUndefined();
  });
});
