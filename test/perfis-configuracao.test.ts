import { afterEach, describe, expect, it } from "vitest";
import { api, startTestFactory, type TestFactory } from "./harness.js";

describe("pessoas e perfis do projeto, pela configuração (fatia 06)", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("grava perfis de nome livre e pessoas com identificador por integração, e a API os devolve", async () => {
    f = await startTestFactory({ config: { name: "exemplo" } });
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");

    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...atual,
      profiles: [
        { nome: "Analista de negócio", papel: "po" },
        { nome: "Arquiteto", papel: "outro" },
      ],
      people: [
        {
          id: "acc-edgar",
          name: "Edgar",
          perfis: ["Analista de negócio", "Arquiteto"],
          identidades: { jira: "acc-edgar", teams: "8:orgid:edgar" },
        },
      ],
    });

    const lido = await api<{
      profiles: { nome: string; papel: string }[];
      people: { id: string; perfis: string[]; identidades: { teams?: string } }[];
    }>(f, "GET", "/projetos/exemplo/configuracao");
    expect(lido.profiles.map((p) => p.nome)).toEqual(["Analista de negócio", "Arquiteto"]);
    expect(lido.people[0]).toMatchObject({
      id: "acc-edgar",
      perfis: ["Analista de negócio", "Arquiteto"],
      identidades: { teams: "8:orgid:edgar" },
    });
  });

  it("recusa uma pessoa que aponta para perfil não cadastrado, dizendo o nome do perfil", async () => {
    f = await startTestFactory({ config: { name: "exemplo" } });
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await fetch(`${f.url}/projetos/exemplo/configuracao`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...atual, profiles: [], people: [{ id: "x", perfis: ["Fantasma"] }] }),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('perfil "Fantasma" não cadastrado');
  });

  it("oferece os modelos prontos de PO e tech lead ao criar um perfil", async () => {
    f = await startTestFactory({});

    const modelos = await api<{ nome: string; papel: string }[]>(f, "GET", "/perfis/modelos");

    expect(modelos).toEqual(
      expect.arrayContaining([
        { nome: "PO", papel: "po" },
        { nome: "Tech Lead", papel: "tech_lead" },
      ]),
    );
  });
});
