import { afterEach, describe, expect, it } from "vitest";
import { FakeModel } from "./fakes/fake-model.js";
import { api, startTestFactory, type TestFactory, testProjectConfig } from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const PROJETO = "exemplo";

async function salvar(f: TestFactory, corpo: unknown): Promise<Response> {
  return fetch(`${f.url}/projetos/${PROJETO}/configuracao`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

describe("configuração por etapa pela API", () => {
  it("grava a configuração de uma etapa e a devolve na leitura", async () => {
    factory = await startTestFactory({ model: new FakeModel() });
    const config = { ...testProjectConfig(), etapas: { review: { ferramentas: ["ler_contexto_review"] } } };
    const resposta = await salvar(factory, config);
    expect(resposta.status).toBe(200);

    const lida = await api<{ etapas?: { review?: { ferramentas?: string[] } } }>(
      factory,
      "GET",
      `/projetos/${PROJETO}/configuracao`,
    );
    expect(lida.etapas?.review?.ferramentas).toEqual(["ler_contexto_review"]);
  });

  it("recusa uma ferramenta fora do catálogo e não grava nada", async () => {
    factory = await startTestFactory({ model: new FakeModel() });
    const config = { ...testProjectConfig(), etapas: { spec: { ferramentas: ["ferramenta_inventada"] } } };
    const resposta = await salvar(factory, config);
    expect(resposta.status).toBe(400);

    const lida = await api<{ etapas?: unknown }>(factory, "GET", `/projetos/${PROJETO}/configuracao`);
    expect(lida.etapas).toBeUndefined();
  });

  it("registra no histórico que o campo etapas mudou", async () => {
    factory = await startTestFactory({ model: new FakeModel() });
    await salvar(factory, { ...testProjectConfig(), etapas: { spec: { promptAdicional: "Use fatias curtas." } } });

    const historico = await api<{ campos: string[] }[]>(factory, "GET", `/projetos/${PROJETO}/historico`);
    expect(historico.some((h) => h.campos.includes("etapas"))).toBe(true);
  });

  it("lista o catálogo de ferramentas com o tipo de cada uma e as etapas que as usam hoje", async () => {
    factory = await startTestFactory({ model: new FakeModel() });
    const catalogo = await api<{ nome: string; tipo: string; etapas: string[] }[]>(factory, "GET", "/ferramentas");
    const escrita = catalogo.find((f) => f.nome === "escrever_arquivo");
    expect(escrita).toMatchObject({ tipo: "escrita", etapas: ["implementacao"] });
    expect(catalogo.find((f) => f.nome === "entregar_spec")?.etapas).toEqual(["spec"]);
  });
});
