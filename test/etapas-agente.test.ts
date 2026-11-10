import { afterEach, describe, expect, it } from "vitest";
import { ferramentasParaEtapa } from "../src/agente-etapa-config.js";
import { createReviewExtension } from "../src/review-stage.js";
import { DEFAULT_SPEC, deliverRetro, deliverSpec, FakeModel } from "./fakes/fake-model.js";
import { poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const card = { key: "PROJ-1", title: "Exportar relatório em CSV", status: "A Fazer", assignee: USER };
const specModel = { provider: FakeModel.PROVIDER, model: "spec-b" };

describe("ferramentasParaEtapa", () => {
  const instancias = [{ name: "entregar_spec" }, { name: "perguntar_po" }] as const;

  it("devolve as ferramentas da etapa na ordem da configuração", () => {
    expect(ferramentasParaEtapa(instancias, ["perguntar_po", "entregar_spec"], "spec").map((t) => t.name)).toEqual([
      "perguntar_po",
      "entregar_spec",
    ]);
  });

  it("recusa uma ferramenta que a etapa não tem, em vez de ignorá-la", () => {
    expect(() => ferramentasParaEtapa(instancias, ["escrever_arquivo"], "spec")).toThrow(
      /não está disponível na etapa spec/,
    );
  });
});

describe("etapa SPEC executa pelo Agente da etapa", () => {
  it("usa o modelo gravado em etapas.spec no lugar do papel", async () => {
    const model = new FakeModel();
    factory = await startTestFactory({ cards: [card], model, config: { etapas: { spec: { modelo: specModel } } } });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const chamada = model.calls.find((c) => c.tools.includes("entregar_spec"));
    expect(chamada?.model).toBe("spec-b");
  });

  it("oferece ao modelo só as ferramentas gravadas para a etapa", async () => {
    const model = new FakeModel();
    factory = await startTestFactory({
      cards: [card],
      model,
      config: { etapas: { spec: { ferramentas: ["entregar_spec"] } } },
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const chamada = model.calls.find((c) => c.tools.includes("entregar_spec"));
    expect(chamada?.tools).toEqual(["entregar_spec"]);
  });

  it("acrescenta o prompt adicional gravado depois do prompt base", async () => {
    const model = new FakeModel();
    factory = await startTestFactory({
      cards: [card],
      model,
      config: { etapas: { spec: { promptAdicional: "Marcador de teste: prefira fatias pequenas." } } },
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const chamada = model.calls.find((c) => c.tools.includes("entregar_spec"));
    expect(chamada?.context).toContain("Marcador de teste: prefira fatias pequenas.");
  });

  it("sem configuração gravada, mantém as ferramentas e o modelo de antes", async () => {
    const model = new FakeModel();
    model.respond = () => deliverSpec(DEFAULT_SPEC);
    factory = await startTestFactory({ cards: [card], model });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const chamada = model.calls.find((c) => c.tools.includes("entregar_spec"));
    expect(chamada?.tools.sort()).toEqual(["entregar_spec", "perguntar_po", "perguntar_tecnico"]);
    expect(chamada?.model).toBe("spec-a");
  });

  it("a retrô da etapa usa o modelo gravado em etapas.retro", async () => {
    const model = new FakeModel();
    model.respondRetro = () => deliverRetro("Sem observações.");
    factory = await startTestFactory({
      cards: [card],
      model,
      config: { etapas: { retro: { modelo: specModel } } },
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    expect(model.retroCalls.length).toBeGreaterThan(0);
    expect(model.retroCalls.every((c) => c.model === "spec-b")).toBe(true);
  });
});

describe("review nunca recebe ferramenta de escrita", () => {
  it("a configuração não consegue ligar escrita na etapa de review", () => {
    const reviewTools = createReviewExtension("/nao-usado").tools;
    expect(() => ferramentasParaEtapa(reviewTools, ["escrever_arquivo"], "review")).toThrow(
      /não está disponível na etapa review/,
    );
  });
});
