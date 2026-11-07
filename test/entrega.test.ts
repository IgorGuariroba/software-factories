import { afterEach, beforeEach, expect, it } from "vitest";
import { DEFAULT_TEST_FILES } from "../src/config.js";
import { FakeClock } from "./fakes/fake-clock.js";
import { FakeCodeHost } from "./fakes/fake-code-host.js";
import { deliverReview, FakeModel, scriptImplementer, write } from "./fakes/fake-model.js";
import { createRemoteRepo, removeTempRoot, tempRoot } from "./fakes/git-repos.js";
import { api, eventually, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

let root: string;
let factory: TestFactory | undefined;
beforeEach(async () => {
  root = await tempRoot();
});
afterEach(async () => {
  await factory?.close();
  factory = undefined;
  await removeTempRoot(root);
});

it("publica PR uma vez, espera sem ocupar a fila e só conclui após observar merge humano, inclusive com reinício", async () => {
  const repo = await createRemoteRepo(root, "app");
  const clock = new FakeClock("2026-11-09T12:00:00Z");
  const codeHost = new FakeCodeHost();
  codeHost.requestState = "open";
  const model = new FakeModel();
  scriptImplementer(
    model,
    {
      spec: "Somar dois números.",
      tickets: [{ titulo: "Somar", aceite: "2 + 3 = 5" }],
    },
    [
      write({
        "test/soma.test.mjs":
          'import { test } from "node:test"; import assert from "node:assert/strict"; import { soma } from "../src/soma.mjs"; test("soma", () => assert.equal(soma(2, 3), 5));',
      }),
      write({ "src/soma.mjs": "export const soma = (a, b) => a + b;" }),
    ],
  );
  factory = await startTestFactory({
    cards: [{ key: "PROJ-1", title: "Somar", status: "A Fazer", assignee: USER }],
    clock,
    codeHost,
    model,
    config: {
      repositories: [
        {
          path: repo.user,
          prefix: "PROJ",
          test: { command: [process.execPath, "--test"], timeoutSeconds: 30, files: DEFAULT_TEST_FILES },
        },
      ],
    },
  });
  await poll(factory);
  await waitForStatus(factory, "PROJ-1", "aguardando-entrega", 3000);
  const detail = await api<{ stage: string; publication: { url: string; status: string } }>(
    factory,
    "GET",
    "/tasks/exemplo/PROJ-1",
  );
  expect(detail.stage).toBe("entrega");
  expect(detail.publication).toMatchObject({ url: "https://code.test/pull/1", status: "aguardando-merge" });
  expect(codeHost.openedRequests).toHaveLength(1);
  expect(model.reviewCalls).toHaveLength(1);
  expect(model.reviewCalls[0]?.tools).not.toContain("escrever_arquivo");
  expect(codeHost.openedRequests[0]?.body).toContain("*mensagem automatizada*");
  expect(await repo.branches()).toContain("main");
  factory = await factory.restart();
  codeHost.requestState = "merged";
  clock.advanceTo("2026-11-09T12:01:01Z");
  await waitForStatus(factory, "PROJ-1", "concluida", 3000);
  expect(codeHost.openedRequests).toHaveLength(1);
  expect(
    (await api<{ publication: { status: string } }>(factory, "GET", "/tasks/exemplo/PROJ-1")).publication.status,
  ).toBe("merged");
}, 15000);

it("corrige achado do review com novo ciclo TDD e só publica o HEAD aprovado", async () => {
  const repo = await createRemoteRepo(root, "app");
  const codeHost = new FakeCodeHost();
  const model = new FakeModel();
  scriptImplementer(
    model,
    {
      spec: "Somar dois números e rejeitar texto.",
      tickets: [{ titulo: "Somar", aceite: "2 + 3 = 5; texto é rejeitado" }],
    },
    [
      write({
        "test/soma.test.mjs":
          'import { test } from "node:test"; import assert from "node:assert/strict"; import { soma } from "../src/soma.mjs"; test("soma", () => assert.equal(soma(2, 3), 5));',
      }),
      write({ "src/soma.mjs": "export const soma = (a, b) => a + b;" }),
      write({
        "test/soma-texto.test.mjs":
          'import { test } from "node:test"; import assert from "node:assert/strict"; import { soma } from "../src/soma.mjs"; test("rejeita texto", () => assert.throws(() => soma("2", 3), TypeError));',
      }),
      write({
        "src/soma.mjs":
          'export const soma = (a, b) => { if (typeof a !== "number" || typeof b !== "number") throw new TypeError("somente números"); return a + b; };',
      }),
    ],
  );
  model.respondReview = () => {
    expect(codeHost.openedRequests).toHaveLength(0);
    return model.reviewCalls.length === 1
      ? deliverReview("corrigir", "Aceite de rejeitar texto não implementado", [
          { titulo: "Rejeitar texto", aceite: "soma com texto lança TypeError" },
        ])
      : deliverReview("aprovado", "Aceites conferidos após correção.");
  };
  factory = await startTestFactory({
    cards: [{ key: "PROJ-1", title: "Somar", status: "A Fazer", assignee: USER }],
    codeHost,
    model,
    config: {
      repositories: [
        {
          path: repo.user,
          prefix: "PROJ",
          test: { command: [process.execPath, "--test"], timeoutSeconds: 30, files: DEFAULT_TEST_FILES },
        },
      ],
    },
  });
  await poll(factory);
  await waitForStatus(factory, "PROJ-1", "concluida", 3000);
  const commits = await repo.branchLog("feature/PROJ-1-somar");
  expect(commits.map((c) => c.subject)).toEqual([
    "test: adiciona teste para Somar",
    "feat: Somar",
    "test: adiciona teste para Rejeitar texto",
    "feat: Rejeitar texto",
  ]);
  expect(model.reviewCalls).toHaveLength(2);
  expect(codeHost.pushed).toHaveLength(1);
  expect(codeHost.openedRequests).toHaveLength(1);
}, 15000);

it("trata achado Major fora do diff após CI verde e atualiza o mesmo PR com TDD e novo review", async () => {
  const repo = await createRemoteRepo(root, "app");
  const codeHost = new FakeCodeHost();
  codeHost.requestState = "open";
  const clock = new FakeClock("2026-11-09T12:00:00Z");
  const model = new FakeModel();
  scriptImplementer(
    model,
    {
      spec: "Somar números e rejeitar texto.",
      tickets: [{ titulo: "Somar", aceite: "2+3=5; texto é rejeitado" }],
    },
    [
      write({
        "test/soma.test.mjs":
          'import { test } from "node:test"; import assert from "node:assert/strict"; import { soma } from "../src/soma.mjs"; test("soma", () => assert.equal(soma(2, 3), 5));',
      }),
      write({ "src/soma.mjs": "export const soma = (a, b) => a + b;" }),
      write({
        "test/texto.test.mjs":
          'import { test } from "node:test"; import assert from "node:assert/strict"; import { soma } from "../src/soma.mjs"; test("texto", () => assert.throws(() => soma("2", 3), TypeError));',
      }),
      write({
        "src/soma.mjs":
          'export const soma = (a, b) => { if (typeof a !== "number" || typeof b !== "number") throw new TypeError(); return a + b; };',
      }),
    ],
  );
  factory = await startTestFactory({
    cards: [{ key: "PROJ-1", title: "Somar", status: "A Fazer", assignee: USER }],
    clock,
    codeHost,
    model,
    config: {
      repositories: [
        {
          path: repo.user,
          prefix: "PROJ",
          test: { command: [process.execPath, "--test"], timeoutSeconds: 30, files: DEFAULT_TEST_FILES },
        },
      ],
    },
  });
  await poll(factory);
  await waitForStatus(factory, "PROJ-1", "aguardando-entrega", 3000);
  codeHost.feedback = [
    {
      id: "review-outside:1",
      author: "reviewer[bot]",
      body: "Major fora do diff: soma aceita texto e concatena em vez de rejeitar.",
    },
  ];
  model.respondReview = (call) => {
    expect(call.input).toContain("Major fora do diff");
    return model.reviewCalls.length === 2
      ? deliverReview("corrigir", "Achado procede", [
          { titulo: "Rejeitar texto", aceite: "entrada textual lança TypeError" },
        ])
      : deliverReview("aprovado", "Reparo verificado no HEAD novo.");
  };
  clock.advanceTo("2026-11-09T12:01:01Z");
  await waitForStatus(factory, "PROJ-1", "aguardando-entrega", 3000);
  await eventually(() => expect(codeHost.pushed).toHaveLength(2));
  expect(model.reviewCalls).toHaveLength(3);
  expect(codeHost.openedRequests).toHaveLength(1);
  const detail = await api<{ publication: { status: string; feedbackIds: string[] } }>(
    factory,
    "GET",
    "/tasks/exemplo/PROJ-1",
  );
  expect(detail.publication).toMatchObject({ status: "aguardando-merge", feedbackIds: ["review-outside:1"] });
  factory = await factory.restart();
  clock.advanceTo("2026-11-09T12:02:02Z");
  await waitForStatus(factory, "PROJ-1", "aguardando-entrega", 3000);
  expect(codeHost.pushed).toHaveLength(2);
  expect(model.reviewCalls).toHaveLength(3);
}, 15000);
