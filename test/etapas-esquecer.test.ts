import { afterEach, describe, expect, it } from "vitest";
import { FakeModel } from "./fakes/fake-model.js";
import { poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const card = { key: "PROJ-1", title: "Exportar relatório em CSV", status: "A Fazer", assignee: USER };
const esquecer = (f: TestFactory, etapa: string) =>
  fetch(`${f.url}/tasks/exemplo/PROJ-1/etapas/${etapa}/memoria/esquecer`, { method: "POST" });

describe("esquecer a memória de uma etapa", () => {
  it("a SPEC esquecida some do trace e a resposta confirma", async () => {
    factory = await startTestFactory({ cards: [card], model: new FakeModel() });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    const antes = (await (await fetch(`${factory.url}/tasks/exemplo/PROJ-1/trace`)).json()) as { etapa: string }[];
    expect(antes.some((e) => e.etapa === "spec")).toBe(true);

    expect((await esquecer(factory, "spec")).status).toBe(200);

    const depois = (await (await fetch(`${factory.url}/tasks/exemplo/PROJ-1/trace`)).json()) as { etapa: string }[];
    expect(depois.some((e) => e.etapa === "spec")).toBe(false);
  });

  it("o esquecimento persiste depois de reiniciar o daemon", async () => {
    factory = await startTestFactory({ cards: [card], model: new FakeModel() });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    await esquecer(factory, "spec");
    factory = await factory.restart();
    const depois = (await (await fetch(`${factory.url}/tasks/exemplo/PROJ-1/trace`)).json()) as { etapa: string }[];
    expect(depois.some((e) => e.etapa === "spec")).toBe(false);
  });

  it("uma etapa sem memória para esquecer responde 409", async () => {
    factory = await startTestFactory({ cards: [card], model: new FakeModel() });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    expect((await esquecer(factory, "review")).status).toBe(409);
  });

  it("uma tarefa inexistente responde 404", async () => {
    factory = await startTestFactory({ cards: [], model: new FakeModel() });
    const r = await fetch(`${factory.url}/tasks/exemplo/NAO-EXISTE/etapas/spec/memoria/esquecer`, { method: "POST" });
    expect(r.status).toBe(404);
  });
});

describe("esquecer nas etapas de review e retrô", () => {
  it("a retrô esquecida deixa de aparecer no trace", async () => {
    factory = await startTestFactory({ cards: [card], model: new FakeModel() });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    const antes = (await (await fetch(`${factory.url}/tasks/exemplo/PROJ-1/trace`)).json()) as { etapa: string }[];
    const retro = antes.find((e) => e.etapa.startsWith("retro:"));
    if (!retro) throw new Error("a retrô deveria aparecer no trace antes de esquecer");
    const r = await fetch(
      `${factory.url}/tasks/exemplo/PROJ-1/etapas/${encodeURIComponent(retro.etapa)}/memoria/esquecer`,
      { method: "POST" },
    );
    expect(r.status).toBe(200);
    const depois = (await (await fetch(`${factory.url}/tasks/exemplo/PROJ-1/trace`)).json()) as { etapa: string }[];
    expect(depois.some((e) => e.etapa === retro.etapa)).toBe(false);
  });

  it("a implementação continua recusando esquecer, porque as tools dela dependem da conversa", async () => {
    factory = await startTestFactory({ cards: [card], model: new FakeModel() });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    expect((await esquecer(factory, "implementacao")).status).toBe(409);
  });
});
