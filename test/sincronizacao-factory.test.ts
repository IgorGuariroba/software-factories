import { afterEach, describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import type { Card } from "../src/demand-source.js";
import { MemoryGitHubSource } from "./fakes/memory-github-source.js";
import {
  api,
  DEFAULT_DESCRIPTION,
  events,
  poll,
  startTestFactory,
  statusOf,
  type TestFactory,
  USER,
} from "./harness.js";

function github(): Partial<ProjectConfig> {
  return {
    source: {
      type: "github",
      project: "SF",
      repo: "dono/repo",
      assignee: USER,
      triageApproval: false,
      maxActive: 1,
      ignoreLabels: ["epic"],
    },
    statuses: { aberta: "todo", fechada: "done" },
  };
}

const issue = (n: number): Card => ({
  key: `SF-${n}`,
  title: `Issue ${n}`,
  status: "aberta",
  assignee: USER,
  description: DEFAULT_DESCRIPTION,
});

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

describe("reconciliação de startup com o GitHub (ADR-0015)", () => {
  it("recupera o fechamento que o webhook perdeu: a Tarefa é cancelada na consulta seguinte", async () => {
    const source = new MemoryGitHubSource([issue(7)]);
    factory = await startTestFactory({ source, config: github() });
    await api(factory, "POST", "/daemon/pause");
    await poll(factory);
    expect(await statusOf(factory, "SF-7")).toBe("enfileirada");

    // Enquanto o daemon esteve fora, a issue foi fechada no GitHub e o webhook não chegou.
    source.changedSince = [
      {
        number: 7,
        title: "Issue 7",
        body: DEFAULT_DESCRIPTION,
        state: "closed",
        labels: [],
        subIssues: 0,
        pullRequest: false,
        updatedAt: "2026-11-09T11:00:00Z",
      },
    ];
    await poll(factory);

    expect(await statusOf(factory, "SF-7")).toBe("cancelada");
  });

  it("a mesma versão da issue, consultada de novo, não muda nada", async () => {
    const source = new MemoryGitHubSource([issue(7)]);
    factory = await startTestFactory({ source, config: github() });
    await api(factory, "POST", "/daemon/pause");
    await poll(factory);
    source.changedSince = [
      {
        number: 7,
        title: "Issue 7",
        body: DEFAULT_DESCRIPTION,
        state: "open",
        labels: [],
        subIssues: 0,
        pullRequest: false,
        updatedAt: "2026-11-09T11:00:00Z",
      },
    ];
    await poll(factory);
    await poll(factory);
    expect(await statusOf(factory, "SF-7")).toBe("enfileirada");
  });

  it("issue nova que mudou desde a última sincronização entra na fila", async () => {
    const source = new MemoryGitHubSource([]);
    factory = await startTestFactory({ source, config: github() });
    await api(factory, "POST", "/daemon/pause");
    await poll(factory);

    source.changedSince = [
      {
        number: 9,
        title: "Issue 9",
        body: DEFAULT_DESCRIPTION,
        state: "open",
        labels: [],
        subIssues: 0,
        pullRequest: false,
        updatedAt: "2026-11-09T11:05:00Z",
      },
    ];
    await poll(factory);

    expect(await statusOf(factory, "SF-9")).toBe("enfileirada");
    expect((await events(factory)).filter((e) => e.type === "notify")).toEqual([]);
  });

  it("uma sincronização falha não derruba a busca: os cards abertos continuam entrando", async () => {
    const source = new MemoryGitHubSource([issue(7)]);
    factory = await startTestFactory({ source, config: github() });
    await api(factory, "POST", "/daemon/pause");
    source.listChangedSince = async () => {
      throw new Error("GitHub fora do ar");
    };
    await poll(factory);
    expect(await statusOf(factory, "SF-7")).toBe("enfileirada");
  });
});
