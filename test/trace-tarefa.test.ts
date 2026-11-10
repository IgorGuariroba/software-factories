import { afterEach, describe, expect, it } from "vitest";
import { FakeModel } from "./fakes/fake-model.js";
import { api, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const card = { key: "PROJ-1", title: "Exportar relatório em CSV", status: "A Fazer", assignee: USER };

type EtapaTrace = {
  etapa: string;
  conversationId: string;
  passos: { tipo: string; ferramenta?: string }[];
  metricas: { chamadas: number; erros: number } | null;
};

describe("GET /tasks/{projeto}/{card}/trace", () => {
  it("devolve, por etapa, os passos da conversa com a chamada da ferramenta de entrega da SPEC", async () => {
    const model = new FakeModel();
    factory = await startTestFactory({ cards: [card], model });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const trace = await api<EtapaTrace[]>(factory, "GET", "/tasks/exemplo/PROJ-1/trace");
    const spec = trace.find((e) => e.etapa === "spec");
    expect(spec).toBeDefined();
    expect(spec?.passos.some((p) => p.tipo === "chamada" && p.ferramenta === "entregar_spec")).toBe(true);
    expect(spec?.passos.some((p) => p.tipo === "usuario")).toBe(true);
  });

  it("cada etapa traz as métricas calculadas a partir do trace", async () => {
    const model = new FakeModel();
    factory = await startTestFactory({ cards: [card], model });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const trace = await api<EtapaTrace[]>(factory, "GET", "/tasks/exemplo/PROJ-1/trace");
    expect(trace.find((e) => e.etapa === "spec")?.metricas).toMatchObject({ chamadas: 1, erros: 0 });
  });

  it("uma tarefa que não existe responde 404", async () => {
    factory = await startTestFactory({ cards: [], model: new FakeModel() });
    const resposta = await fetch(`${factory.url}/tasks/exemplo/NAO-EXISTE/trace`);
    expect(resposta.status).toBe(404);
  });
});
