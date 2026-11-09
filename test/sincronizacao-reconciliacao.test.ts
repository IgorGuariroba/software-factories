import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import type { IssueSnapshot } from "../src/demand-source.js";
import type { FactoryState, QueuedTask } from "../src/durable.js";
import { CLOSED_REASON, type IssueDelivery, reconciliarIssues, type WebhookProject } from "../src/github-webhook.js";
import { testProjectConfig } from "./harness.js";

const REPO = "dono/repo";
const config: ProjectConfig = testProjectConfig({
  name: "exemplo",
  source: {
    type: "github",
    project: "SF",
    repo: REPO,
    assignee: "igor",
    triageApproval: false,
    maxActive: 1,
    ignoreLabels: ["epic"],
  },
  statuses: { aberta: "todo", fechada: "done" },
});
const projects: WebhookProject[] = [{ name: "exemplo", config }];

const taskIn = (status: QueuedTask["status"], extra: Partial<QueuedTask> = {}): QueuedTask =>
  ({
    id: "exemplo/SF-7",
    project: "exemplo",
    key: "SF-7",
    title: "Exportar CSV",
    ref: "r",
    status,
    durableId: null,
    gateId: null,
    pauseRequested: false,
    notBefore: null,
    attempts: 0,
    reason: null,
    startedIn: "todo",
    veto: null,
    delivery: null,
    implementation: null,
    scope: { description: "corpo", checkboxes: { done: 0, total: 0 } },
    ...extra,
  }) as QueuedTask;

const snap = (overrides: Partial<IssueSnapshot> = {}): IssueSnapshot => ({
  number: 7,
  title: "Exportar CSV",
  body: "corpo",
  state: "open",
  labels: [],
  subIssues: 0,
  pullRequest: false,
  updatedAt: "2026-11-09T11:00:00Z",
  ...overrides,
});

const run = (state: FactoryState, snapshots: IssueSnapshot[]): IssueDelivery[] =>
  reconciliarIssues({ state, project: projects[0] as WebhookProject, snapshots });

describe("reconciliarIssues: o que mudou no GitHub enquanto o daemon esteve fora", () => {
  it("issue fechada com Tarefa não terminada vira entrega de fechamento", () => {
    const state: FactoryState = { daemonPaused: false, tasks: [taskIn("enfileirada")] };
    const [d] = run(state, [snap({ state: "closed" })]);
    expect(d).toMatchObject({ action: "closed", repo: REPO, issue: { number: 7, state: "closed" } });
  });

  it("issue fechada sem Tarefa não gera nada", () => {
    const state: FactoryState = { daemonPaused: false, tasks: [] };
    expect(run(state, [snap({ state: "closed" })])).toEqual([]);
  });

  it("issue reaberta cancelada pelo próprio fechamento vira reabertura", () => {
    const state: FactoryState = {
      daemonPaused: false,
      tasks: [taskIn("cancelada", { reason: CLOSED_REASON })],
    };
    const [d] = run(state, [snap()]);
    expect(d?.action).toBe("reopened");
  });

  it("issue aberta nova e elegível vira abertura", () => {
    const state: FactoryState = { daemonPaused: false, tasks: [] };
    const [d] = run(state, [snap({ number: 9 })]);
    expect(d).toMatchObject({ action: "opened", issue: { number: 9 } });
  });

  it("título ou corpo mudados numa Tarefa existente vira edição", () => {
    const state: FactoryState = { daemonPaused: false, tasks: [taskIn("aguardando-humano")] };
    expect(run(state, [snap({ title: "Exportar CSV com cabeçalho" })])[0]?.action).toBe("edited");
    expect(run(state, [snap({ body: "corpo novo" })])[0]?.action).toBe("edited");
  });

  it("issue igual à Tarefa não gera entrega: uma edição falsa marcaria a execução como desatualizada", () => {
    const state: FactoryState = { daemonPaused: false, tasks: [taskIn("ativa", { durableId: 3 })] };
    expect(run(state, [snap()])).toEqual([]);
  });

  it("pull request e épico não geram entrega", () => {
    const state: FactoryState = { daemonPaused: false, tasks: [] };
    expect(run(state, [snap({ pullRequest: true })])).toEqual([]);
    expect(run(state, [snap({ labels: ["epic"] })])).toEqual([]);
  });

  it("a identificação da entrega inclui a versão da issue: a mesma versão não é aplicada duas vezes", () => {
    const state: FactoryState = { daemonPaused: false, tasks: [taskIn("enfileirada")] };
    const [a] = run(state, [snap({ state: "closed", updatedAt: "2026-11-09T11:00:00Z" })]);
    const [b] = run(state, [snap({ state: "closed", updatedAt: "2026-11-09T11:30:00Z" })]);
    expect(a?.deliveryId).not.toBe(b?.deliveryId);
    expect(a?.deliveryId).toBe(
      run(state, [snap({ state: "closed", updatedAt: "2026-11-09T11:00:00Z" })])[0]?.deliveryId,
    );
  });
});
