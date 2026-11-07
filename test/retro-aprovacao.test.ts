import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TEST_FILES } from "../src/config.js";
import { deliverRetro, FakeModel, scriptImplementer, write } from "./fakes/fake-model.js";
import { createRemoteRepo, removeTempRoot, tempRoot } from "./fakes/git-repos.js";
import { api, events, eventually, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

let factory: TestFactory | undefined;
let root: string | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
  if (root) await removeTempRoot(root);
  root = undefined;
});

const NODE_TEST = { command: [process.execPath, "--test"], timeoutSeconds: 30, files: DEFAULT_TEST_FILES };
const retroNotices = async (f: TestFactory) =>
  (await events(f)).filter((e) => e.type === "notify" && e.reason === "retro-pronta");

const card = { key: "PROJ-1", title: "Exportar relatório", status: "A Fazer", assignee: USER };
type Detail = { status: string; retros: { stage: string; status: string }[] };
const detail = (f: TestFactory) => api<Detail>(f, "GET", "/tasks/exemplo/PROJ-1");

describe("portão depois da retrô da SPEC", () => {
  it("pausa a Tarefa depois da retrô da SPEC até o usuário retomar, mesmo após reinício", async () => {
    factory = await startTestFactory({ cards: [card], config: { retroApproval: true } });
    factory.model.respondRetro = () => deliverRetro("Retrô.", []);
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "pausada");

    const held = await detail(factory);
    expect(held.retros.map((r) => r.stage)).toEqual(["spec"]);
    expect(factory.model.retroCalls).toHaveLength(1);
    expect(await retroNotices(factory)).toHaveLength(1);

    factory = await factory.restart();
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "pausada");
    expect(factory.model.retroCalls).toHaveLength(1);

    await api(factory, "POST", "/tasks/exemplo/PROJ-1/resume");
    await waitForStatus(factory, "PROJ-1", "concluida");
    await eventually(async () => expect((await detail(factory as TestFactory)).retros.length).toBeGreaterThan(1));
  });

  it("pausa também depois da retrô da implementação", { timeout: 60_000 }, async () => {
    root = await tempRoot();
    const repo = await createRemoteRepo(root, "app");
    const model = new FakeModel();
    scriptImplementer(model, { spec: "CSV.", tickets: [{ titulo: "Gerar CSV", aceite: "gera" }] }, [
      write({
        "test/csv.test.mjs": 'import { test } from "node:test";\nimport "../src/csv.mjs";\ntest("x", () => {});\n',
      }),
      write({ "src/csv.mjs": "export const x = 1;\n" }),
    ]);
    model.respondRetro = () => deliverRetro("Retrô.", []);
    factory = await startTestFactory({
      cards: [card],
      model,
      config: { retroApproval: true, repositories: [{ path: repo.user, prefix: "PROJ", test: NODE_TEST }] },
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "pausada");
    await api(factory, "POST", "/tasks/exemplo/PROJ-1/resume");

    await eventually(async () => expect(await retroNotices(factory as TestFactory)).toHaveLength(2), 45_000);
    await waitForStatus(factory, "PROJ-1", "pausada");
    expect((await detail(factory)).retros.map((r) => r.stage)).toEqual(["spec", "implementacao"]);

    for (const stages of [
      ["spec", "implementacao", "review"],
      ["spec", "implementacao", "review", "mr"],
    ]) {
      await api(factory, "POST", "/tasks/exemplo/PROJ-1/resume");
      await eventually(
        async () => expect((await detail(factory as TestFactory)).retros.map((r) => r.stage)).toEqual(stages),
        45_000,
      );
      await waitForStatus(factory, "PROJ-1", "pausada");
    }
    await api(factory, "POST", "/tasks/exemplo/PROJ-1/resume");
    await waitForStatus(factory, "PROJ-1", "concluida");
    expect((await detail(factory)).retros.map((r) => r.stage)).toEqual([
      "spec",
      "implementacao",
      "review",
      "mr",
      "tarefa",
    ]);
  });

  it("sem retroApproval, segue direto para a implementação", async () => {
    factory = await startTestFactory({ cards: [card] });
    factory.model.respondRetro = () => deliverRetro("Retrô.", []);
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
  });
});
