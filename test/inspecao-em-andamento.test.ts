import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TEST_FILES } from "../src/config.js";
import { createRemoteRepo, removeTempRoot, tempRoot } from "./fakes/git-repos.js";
import { api, events, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

let factory: TestFactory | undefined;
let root: string | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
  if (root) await removeTempRoot(root);
  root = undefined;
});

const NODE_TEST = { command: [process.execPath, "--test"], timeoutSeconds: 30, files: DEFAULT_TEST_FILES };
const card = { key: "PROJ-1", title: "Exportar relatório", status: "Em Andamento", assignee: USER };

async function startWithRepo(commits: string[]) {
  root = await tempRoot();
  const repo = await createRemoteRepo(root, "app", { commits });
  factory = await startTestFactory({
    cards: [card],
    config: { retroApproval: true, repositories: [{ path: repo.user, prefix: "PROJ", test: NODE_TEST }] },
  });
  return factory;
}

describe("card 'Em Andamento' com repositório mapeado: inspeção no lugar do veto", () => {
  it("sem trabalho anterior no repositório, segue direto, sem prazo de veto", async () => {
    const f = await startWithRepo(["feat(PROJ-10): outra coisa"]);
    await poll(f);
    // Parada antes da implementação pelo portão da retrô: passou do veto e da SPEC sem esperar o prazo.
    await waitForStatus(f, "PROJ-1", "pausada");

    const all = await events(f);
    expect(all.some((e) => e.type === "notify" && e.reason === "aguardando-veto")).toBe(false);
    expect(all.some((e) => e.type === "assumed" && e.target === "PROJ-1")).toBe(true);
  });

  it("com o card já mergeado na branch padrão, fica bloqueada com o motivo e não reimplementa", async () => {
    const f = await startWithRepo(["Merge branch 'feature/PROJ-1' into 'main'"]);
    await poll(f);
    await waitForStatus(f, "PROJ-1", "bloqueada");

    const task = await api<{ reason: string | null }>(f, "GET", "/tasks/exemplo/PROJ-1");
    expect(task.reason).toMatch(/já implementado/);
    expect(f.model.retroCalls).toHaveLength(0);
  });

  it("ao reiniciar, uma Tarefa que já esperava o veto é reinspecionada e segue sem esperar o prazo", async () => {
    factory = await startTestFactory({ cards: [card] });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-veto");

    root = await tempRoot();
    const repo = await createRemoteRepo(root, "app");
    factory = await factory.restart({
      config: { retroApproval: true, repositories: [{ path: repo.user, prefix: "PROJ", test: NODE_TEST }] },
    });
    const f = factory;
    // Parada antes da implementação pelo portão da retrô: passou do veto e da SPEC sem esperar o prazo.
    await waitForStatus(f, "PROJ-1", "pausada");
  });
});
