import { afterEach, describe, expect, it } from "vitest";
import { deliverSpec, FakeModel } from "./fakes/fake-model.js";
import { hold, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const card = { key: "PROJ-1", title: "Exportar relatório em CSV", status: "A Fazer", assignee: USER };

async function mandar(f: TestFactory, etapa: string, texto: string): Promise<Response> {
  return fetch(`${f.url}/tasks/exemplo/PROJ-1/etapas/${etapa}/mensagem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ texto }),
  });
}

type Passo = { tipo: string; texto?: string };
async function passosDaSpec(f: TestFactory): Promise<Passo[]> {
  const trace = (await (await fetch(`${f.url}/tasks/exemplo/PROJ-1/trace`)).json()) as {
    etapa: string;
    passos: Passo[];
  }[];
  return trace.find((e) => e.etapa === "spec")?.passos ?? [];
}

describe("mensagem do usuário para o Agente da etapa", () => {
  it("com a etapa parada, a mensagem inicia um turno novo e aparece no trace", async () => {
    const model = new FakeModel();
    factory = await startTestFactory({ cards: [card], model });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const resposta = await mandar(factory, "spec", "Prefira fatias pequenas.");
    expect(resposta.status).toBe(200);

    const passos = await passosDaSpec(factory);
    expect(passos.some((p) => p.tipo === "usuario" && p.texto === "Prefira fatias pequenas.")).toBe(true);
  });

  it("com a etapa em execução, a mensagem é aceita como steer (sem reiniciar a etapa)", async () => {
    const model = new FakeModel();
    const reached = hold();
    const gate = hold();
    model.respond = async () => {
      reached.release();
      await gate.promise;
      return deliverSpec({
        spec: "Exportação em CSV.",
        tickets: [{ titulo: "Endpoint", aceite: "Responde 200" }],
      });
    };
    factory = await startTestFactory({ cards: [card], model });
    const executando = poll(factory);
    await reached.promise;

    const resposta = await mandar(factory, "spec", "Mantenha o cabeçalho em português.");
    expect(resposta.status).toBe(200);
    gate.release();
    await executando;
    await waitForStatus(factory, "PROJ-1", "concluida");
    // A SPEC encerra com a ferramenta de entrega, que não deixa ponto de decisão depois dela: o steer fica na fila
    // da conversa e não aparece no trace desta etapa. Só etapas com ferramentas não terminais o consomem.
  });

  it("uma etapa que não existe na tarefa responde 404", async () => {
    factory = await startTestFactory({ cards: [card], model: new FakeModel() });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    const resposta = await mandar(factory, "review", "oi");
    expect(resposta.status).toBe(404);
  });

  it("uma mensagem vazia é recusada", async () => {
    factory = await startTestFactory({ cards: [card], model: new FakeModel() });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    const resposta = await mandar(factory, "spec", "   ");
    expect(resposta.status).toBe(400);
  });
});
