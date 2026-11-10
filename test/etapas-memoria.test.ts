import { afterEach, describe, expect, it } from "vitest";
import { FakeModel } from "./fakes/fake-model.js";
import { poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const cards = [
  { key: "PROJ-1", title: "Exportar relatório em CSV", status: "A Fazer", assignee: USER },
  { key: "PROJ-2", title: "Importar contatos da planilha", status: "A Fazer", assignee: USER },
];

type Etapa = { etapa: string; passos: { tipo: string; ferramenta?: string; texto?: string }[] };
const trace = async (f: TestFactory, key: string): Promise<Etapa[]> =>
  (await (await fetch(`${f.url}/tasks/exemplo/${key}/trace`)).json()) as Etapa[];

describe("memória da etapa é por tarefa e persiste", () => {
  it("a memória de uma tarefa não aparece na de outra tarefa", async () => {
    factory = await startTestFactory({ cards, model: new FakeModel() });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    await waitForStatus(factory, "PROJ-2", "concluida");

    const outra = JSON.stringify(await trace(factory, "PROJ-2"));
    expect(outra).toContain("Importar contatos");
    expect(outra).not.toContain("Exportar relatório");
  });

  it("a memória da etapa continua disponível depois de reiniciar o daemon", async () => {
    factory = await startTestFactory({ cards: [cards[0] as (typeof cards)[number]], model: new FakeModel() });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    const antes = await trace(factory, "PROJ-1");

    // `restart()` fecha esta fábrica e sobe outra sobre o mesmo estado durável.
    factory = await factory.restart();

    const depois = await trace(factory, "PROJ-1");
    expect(depois).toEqual(antes);
    expect(depois.find((e) => e.etapa === "spec")?.passos.some((p) => p.ferramenta === "entregar_spec")).toBe(true);
  });
});
