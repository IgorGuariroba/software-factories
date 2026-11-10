import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import type { FactoryState, QueuedTask } from "../src/durable.js";
import type { RawIssue } from "../src/github-demand-source.js";
import type { WebhookProject } from "../src/github-webhook.js";
import { aplicarImportacao } from "../src/importacao-issues.js";

const REPO_ID = 555;
const REPO = "dono/repo";

const config = {
  name: "SF",
  source: {
    type: "github",
    project: "SF",
    repo: REPO,
    assignee: "dono",
    triageApproval: false,
    maxActive: 1,
    ignoreLabels: ["epic"],
  },
  statuses: { aberta: "todo", fechada: "done" },
} as unknown as ProjectConfig;

const projeto: WebhookProject = { name: "SF", config };

const issue = (number: number, over: Partial<RawIssue> = {}): RawIssue => ({
  id: 9000 + number,
  number,
  title: `Issue ${number}`,
  body: "- [x] feito\n- [ ] falta",
  state: "open",
  labels: [],
  ...over,
});

let contador = 0;
const newRef = () => `ref-${++contador}`;
const estado = (tasks: QueuedTask[] = []): FactoryState => ({ daemonPaused: false, tasks });

describe("aplicarImportacao: o que cada issue aberta vira", () => {
  it("cria uma Tarefa por issue aberta elegível, com a origem GitHub gravada", () => {
    const state = estado();
    const { resultado } = aplicarImportacao({
      state,
      project: projeto,
      repoId: REPO_ID,
      repo: REPO,
      installationId: 1,
      issues: [issue(1), issue(2)],
      newRef,
    });
    expect(resultado).toEqual({ criadas: 2, vinculadas: 0, atualizadas: 0, ignoradas: 0 });
    expect(state.tasks.map((t) => t.id)).toEqual(["SF/SF-1", "SF/SF-2"]);
    expect(state.tasks[0]?.origem).toEqual({
      repoId: REPO_ID,
      repo: REPO,
      issueId: 9001,
      issueNumber: 1,
      installationId: 1,
    });
    expect(state.tasks[0]?.scope?.checkboxes).toEqual({ done: 1, total: 2 });
  });

  it("pull requests vindos no endpoint de issues não viram Tarefa", () => {
    const state = estado();
    const { resultado } = aplicarImportacao({
      state,
      project: projeto,
      repoId: REPO_ID,
      repo: REPO,
      issues: [issue(3, { pull_request: { url: "x" } })],
      newRef,
    });
    expect(state.tasks).toEqual([]);
    expect(resultado.criadas).toBe(0);
  });

  it("épicos e labels ignorados ficam de fora e contam como ignorados", () => {
    const state = estado();
    const { resultado } = aplicarImportacao({
      state,
      project: projeto,
      repoId: REPO_ID,
      repo: REPO,
      issues: [issue(4, { labels: ["epic"] }), issue(5, { sub_issues_summary: { total: 2 } })],
      newRef,
    });
    expect(state.tasks).toEqual([]);
    expect(resultado.ignoradas).toBe(2);
  });

  it("Tarefa da busca antiga, com a mesma chave e sem origem, é vinculada e não duplicada", () => {
    const legada = {
      id: "SF/SF-7",
      project: "SF",
      key: "SF-7",
      title: "antigo",
      status: "enfileirada",
    } as unknown as QueuedTask;
    const state = estado([legada]);
    const { resultado } = aplicarImportacao({
      state,
      project: projeto,
      repoId: REPO_ID,
      repo: REPO,
      issues: [issue(7)],
      newRef,
    });
    expect(state.tasks).toHaveLength(1);
    expect(resultado).toMatchObject({ criadas: 0, vinculadas: 1 });
    expect(state.tasks[0]?.origem?.issueNumber).toBe(7);
  });

  it("rodar de novo com as mesmas issues não cria nada (idempotente)", () => {
    const state = estado();
    const args = { state, project: projeto, repoId: REPO_ID, repo: REPO, issues: [issue(1), issue(2)], newRef };
    aplicarImportacao(args);
    const depois = JSON.stringify(state);
    const { resultado } = aplicarImportacao(args);
    expect(JSON.stringify(state)).toBe(depois);
    expect(resultado).toEqual({ criadas: 0, vinculadas: 0, atualizadas: 2, ignoradas: 0 });
  });

  it("issue já importada e com novo título atualiza o título, sem criar Tarefa", () => {
    const state = estado();
    aplicarImportacao({ state, project: projeto, repoId: REPO_ID, repo: REPO, issues: [issue(1)], newRef });
    aplicarImportacao({
      state,
      project: projeto,
      repoId: REPO_ID,
      repo: REPO,
      issues: [issue(1, { title: "Título novo" })],
      newRef,
    });
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]?.title).toBe("Título novo");
  });

  it("chave já usada por outra origem não gera duplicata: a identidade fica com a primeira", () => {
    const outra = {
      id: "SF/SF-1",
      project: "SF",
      key: "SF-1",
      title: "de outro repo",
      status: "enfileirada",
      origem: { repoId: 999, repo: "outro/x", issueId: 1, issueNumber: 1 },
    } as unknown as QueuedTask;
    const state = estado([outra]);
    const { resultado } = aplicarImportacao({
      state,
      project: projeto,
      repoId: REPO_ID,
      repo: REPO,
      issues: [issue(1)],
      newRef,
    });
    expect(state.tasks).toHaveLength(1);
    expect(resultado.ignoradas).toBe(1);
  });
});
