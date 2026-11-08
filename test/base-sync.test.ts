import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { DEFAULT_TEST_FILES } from "../src/config.js";
import { FakeCodeHost } from "./fakes/fake-code-host.js";
import { FakeModel, scriptImplementer, write } from "./fakes/fake-model.js";
import { createRemoteRepo, git, removeTempRoot, tempRoot } from "./fakes/git-repos.js";
import { api, hold, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

let factory: TestFactory | undefined;
let root: string;
afterEach(async () => {
  await factory?.close();
  if (root) await removeTempRoot(root);
});

it.each([
  { valid: true, restart: false },
  { valid: false, restart: false },
  { valid: true, restart: true },
])(
  "sincroniza base com conflito (válido: $valid, reinício: $restart) antes de publicar",
  async ({ valid, restart }) => {
    root = await tempRoot();
    const repo = await createRemoteRepo(root, "app", { files: { "src/value.mjs": "export const value = 0;\n" } });
    const model = new FakeModel();
    const codeHost = new FakeCodeHost();
    codeHost.requestState = "open";
    let base = "";
    let snapshot = "";
    const started = hold();
    const release = hold();
    let suspended = false;
    const resolve = async () => {
      if (restart && !suspended) {
        suspended = true;
        started.release();
        await release.promise;
      }
      return write({ "src/value.mjs": `export const value = ${valid ? 1 : 2}; export const nova = true;\n` });
    };
    scriptImplementer(model, { spec: "Valor um", tickets: [{ titulo: "Valor", aceite: "retorna um" }] }, [
      write({
        "test/value.test.mjs":
          "import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.mjs';test('valor',()=>assert.equal(value,1));",
      }),
      async () => {
        // Outra pessoa altera o remoto enquanto a fábrica implementa, sem tocar o clone dela.
        await writeFile(join(repo.user, "src/value.mjs"), "export const value = 0; export const nova = true;\n");
        await git(repo.user, "add", ".");
        await git(repo.user, "commit", "-m", "feat: mudança concorrente na base");
        await git(repo.user, "push", "origin", "main");
        base = await git(repo.user, "rev-parse", "HEAD");
        snapshot = await repo.userSnapshot();
        return write({ "src/value.mjs": "export const value = 1;\n" });
      },
      resolve,
      resolve,
      resolve,
    ]);
    factory = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "Valor", status: "A Fazer", assignee: USER }],
      model,
      codeHost,
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
    if (restart) {
      await started.promise;
      const restarting = factory.restart();
      await new Promise<void>((resolve) => setImmediate(resolve));
      release.release();
      factory = await restarting;
    }
    if (!valid) {
      await waitForStatus(factory, "PROJ-1", "bloqueada", 5000);
      expect(codeHost.openedRequests).toHaveLength(0);
      expect(await repo.branches()).toEqual(["main"]);
      const blocked = await api<{ resumeAllowed: boolean }>(factory, "GET", "/tasks/exemplo/PROJ-1");
      expect(blocked.resumeAllowed).toBe(true);
      await writeFile(
        join(factory.stateDir, "worktrees", "exemplo", "PROJ-1", "src/value.mjs"),
        "export const value = 1; export const nova = true;\n",
      );
      await api(factory, "POST", "/tasks/exemplo/PROJ-1/resume");
    }
    await waitForStatus(factory, "PROJ-1", "aguardando-entrega", 5000);
    const branch = "feature/PROJ-1-valor";
    expect(await repo.show(branch, "src/value.mjs")).toContain("nova = true");
    expect(await repo.show(branch, "src/value.mjs")).toContain("value = 1");
    expect(await git(repo.bare, "merge-base", "--is-ancestor", base, branch)).toBe("");
    expect(await git(repo.bare, "rev-parse", "main")).toBe(base);
    expect(await repo.userSnapshot()).toBe(snapshot);
    const detail = await api<{
      implementation: { synchronization: { base: string; head: string; status: string } };
      review: { head: string; status: string };
    }>(factory, "GET", "/tasks/exemplo/PROJ-1");
    expect(detail.implementation.synchronization).toMatchObject({ base, status: "concluida" });
    expect(detail.review).toMatchObject({ head: detail.implementation.synchronization.head, status: "aprovado" });
    expect(codeHost.openedRequests).toHaveLength(1);
  },
  15000,
);
