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

it("reconhece RED resolvido apenas por formatação na retomada, sem aceitar commit vazio", async () => {
  root = await tempRoot();
  const repo = await createRemoteRepo(root, "app");
  const formatter = join(root, "formatar.mjs");
  await writeFile(
    formatter,
    `import {readFileSync,writeFileSync} from 'node:fs';
writeFileSync('src/value.mjs',readFileSync('src/value.mjs','utf8').replace(/[ ]+$/gm,''));`,
  );
  const model = new FakeModel();
  scriptImplementer(
    model,
    {
      spec: "Valor e formatação",
      tickets: [
        { titulo: "Valor", aceite: "retorna um" },
        { titulo: "Formatação", aceite: "sem espaços finais" },
      ],
    },
    [
      write({
        "test/value.test.mjs": `import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.mjs';test('valor',()=>assert.equal(value,1));`,
      }),
      write({ "src/value.mjs": "export const value = 1;   \n" }),
      write({
        "test/format.test.mjs": `import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('formato',()=>assert.equal(/[ ]+$/m.test(readFileSync('src/value.mjs','utf8')),false));`,
      }),
    ],
  );
  const mapping = {
    path: repo.user,
    prefix: "PROJ",
    test: { command: [process.execPath, "--test"], timeoutSeconds: 10, files: DEFAULT_TEST_FILES },
  };
  factory = await startTestFactory({
    cards: [{ key: "PROJ-1", title: "Valor", status: "A Fazer", assignee: USER }],
    model,
    config: { repositories: [mapping] },
  });
  await poll(factory);
  await waitForStatus(factory, "PROJ-1", "bloqueada", 5000);
  factory = await factory.restart({
    config: { repositories: [{ ...mapping, format: { command: [process.execPath, formatter], timeoutSeconds: 10 } }] },
  });
  await api(factory, "POST", "/tasks/exemplo/PROJ-1/resume");
  await waitForStatus(factory, "PROJ-1", "concluida", 5000);
  const detail = await api<{
    implementation: { commits: { ticket: number; phase: string; sha: string }[] };
    events: { message?: string }[];
  }>(factory, "GET", "/tasks/exemplo/PROJ-1");
  expect(detail.implementation.commits.filter((c) => c.ticket === 1 && c.phase === "implementacao")).toHaveLength(1);
  expect(detail.events.some((e) => e.message?.includes("RED resolvido pelo formatador"))).toBe(true);
  expect((await repo.branchLog("feature/PROJ-1-valor")).map((c) => c.subject)).toHaveLength(4);
}, 20000);
