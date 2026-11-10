import { describe, expect, it } from "vitest";
import { pessoasDoPapel, proximaPessoaDoPapel, validarPerfis } from "../src/packages/profiles/index.js";

// Fatia 07: uma pessoa pode ter vários perfis, e um perfil pode ter várias pessoas, em ordem.
describe("perfis: atribuição N:N com ordem e roteamento por papel", () => {
  const perfis = [
    { nome: "Analista de negócio", papel: "po" as const },
    { nome: "Tech Lead", papel: "tech_lead" as const },
    { nome: "Arquiteto", papel: "outro" as const },
  ];
  const pessoas = [
    { id: "ana", perfis: ["Analista de negócio"] },
    { id: "bruno", perfis: ["Analista de negócio", "Tech Lead"] },
    { id: "carla", perfis: ["Arquiteto"] },
    { id: "dani" },
  ];

  it("encontra as pessoas de um papel na ordem da lista, inclusive quem tem vários perfis", () => {
    expect(pessoasDoPapel({ profiles: perfis, people: pessoas }, "po").map((p) => p.id)).toEqual(["ana", "bruno"]);
    expect(pessoasDoPapel({ profiles: perfis, people: pessoas }, "tech_lead").map((p) => p.id)).toEqual(["bruno"]);
  });

  it("um perfil de papel outro não entra no roteamento de perguntas", () => {
    expect(pessoasDoPapel({ profiles: perfis, people: pessoas }, "po").some((p) => p.id === "carla")).toBe(false);
  });

  it("pessoa sem perfil não recebe pergunta de papel nenhum", () => {
    for (const papel of ["po", "tech_lead"] as const)
      expect(pessoasDoPapel({ profiles: perfis, people: pessoas }, papel).some((p) => p.id === "dani")).toBe(false);
  });

  it("aceita a forma antiga, com `role` direto na pessoa, como um perfil de mesmo papel", () => {
    const legado = [{ id: "velha", role: "po" as const }];
    expect(pessoasDoPapel({ profiles: [], people: legado }, "po").map((p) => p.id)).toEqual(["velha"]);
  });

  it("recusa uma pessoa que aponta para um perfil não cadastrado, dizendo qual", () => {
    expect(validarPerfis({ profiles: perfis, people: [{ id: "x", perfis: ["Fantasma"] }] })).toEqual([
      'pessoa x: perfil "Fantasma" não cadastrado',
    ]);
  });

  it("recusa dois perfis com o mesmo nome", () => {
    expect(
      validarPerfis({ profiles: [...perfis, { nome: "Tech Lead", papel: "outro" as const }], people: [] }),
    ).toEqual(['perfil "Tech Lead" repetido']);
  });

  it("a próxima pessoa do papel segue a ordem da lista, e não há próxima depois da última", () => {
    const config = { profiles: perfis, people: pessoas };
    expect(proximaPessoaDoPapel(config, "po", "ana")?.id).toBe("bruno");
    expect(proximaPessoaDoPapel(config, "po", "bruno")).toBeUndefined();
  });
});
