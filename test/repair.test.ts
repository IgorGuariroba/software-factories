import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { DEFAULT_TEST_FILES } from "../src/config.js";
import { FakeModel, scriptImplementer, write } from "./fakes/fake-model.js";
import { createRemoteRepo, removeTempRoot, tempRoot } from "./fakes/git-repos.js";
import { api, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

let factory: TestFactory | undefined;
let root: string;
afterEach(async () => {
  await factory?.close();
  if (root) await removeTempRoot(root);
});

it("integra reparo humano aprovado no checkpoint sem retomar, e sobrevive a reinício", async () => {
  root = await tempRoot();
  const repo = await createRemoteRepo(root, "app", { files: { "src/value.mjs": "export const value = 0;\n" } });
  const model = new FakeModel();
  const test = `import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.mjs';test('valor',()=>assert.equal(value,1));`;
  scriptImplementer(model, { spec: "Valor", tickets: [{ titulo: "Valor", aceite: "retorna um" }] }, [
    write({ "test/value.test.mjs": test }),
    write({ "src/value.mjs": "export const value = 2;\n" }),
  ]);
  factory = await startTestFactory({
    cards: [{ key: "PROJ-1", title: "Valor", status: "A Fazer", assignee: USER }],
    model,
    config: {
      repositories: [
        {
          path: repo.user,
          prefix: "PROJ",
          test: { command: [process.execPath, "--test"], timeoutSeconds: 10, files: DEFAULT_TEST_FILES },
        },
      ],
    },
  });
  await poll(factory);
  await waitForStatus(factory, "PROJ-1", "bloqueada", 5000);
  const cwd = join(factory.stateDir, "worktrees", "exemplo", "PROJ-1");
  const path = "/tasks/exemplo/PROJ-1/repair";
  const old = await api<{ revision: string }>(factory, "GET", path);
  // Código que ainda falha nunca vira checkpoint.
  let response = await fetch(factory.url + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: old.revision, approveTestChanges: true }),
  });
  expect(response.status).toBe(409);
  await writeFile(join(cwd, "src/value.mjs"), "export const value = 1;\n");
  await writeFile(
    join(cwd, "test/value.test.mjs"),
    `${test}\n// Reparação revisada: a mesma assertion é preservada.\n`,
  );
  response = await fetch(factory.url + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: old.revision, approveTestChanges: true }),
  });
  expect(response.status).toBe(409);
  const preview = await api<{ revision: string; paths: string[] }>(factory, "GET", path);
  expect(preview.paths).toContain("test/value.test.mjs");
  response = await fetch(factory.url + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: preview.revision }),
  });
  expect(response.status).toBe(400);
  const integrated = await api<{ sha: string }>(factory, "POST", path, {
    revision: preview.revision,
    approveTestChanges: true,
  });
  expect(integrated.sha).toMatch(/^[0-9a-f]{40}$/);
  const detail = await api<{ status: string; implementation: { repairs: { sha: string }[] } }>(
    factory,
    "GET",
    "/tasks/exemplo/PROJ-1",
  );
  expect(detail.status).toBe("bloqueada");
  expect(detail.implementation.repairs).toEqual([expect.objectContaining({ sha: integrated.sha })]);
  expect(await repo.branches()).toEqual(["main"]);
  factory = await factory.restart();
  await api(factory, "POST", "/tasks/exemplo/PROJ-1/resume");
  await waitForStatus(factory, "PROJ-1", "concluida", 5000);
  expect(
    (await repo.branchLog("feature/PROJ-1-valor")).filter((c) => c.subject.includes("factory-repair")),
  ).toHaveLength(1);
}, 20000);
