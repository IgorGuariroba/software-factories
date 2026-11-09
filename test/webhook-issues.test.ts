import { describe, expect, it } from "vitest";
import { type ProjectConfig, ProjectConfig as ProjectConfigSchema } from "../src/config.js";
import type { FactoryState, QueuedTask } from "../src/durable.js";
import { applyIssueDelivery, parseGitHubDelivery, type WebhookProject } from "../src/github-webhook.js";
import { testProjectConfig } from "./harness.js";

const REPO = "acme/app";

/** Projeto de repositório monitorado, com os estados que a fábrica entende. */
function githubProject(overrides: Partial<ProjectConfig["source"]> = {}, statuses?: ProjectConfig["statuses"]) {
  return testProjectConfig({
    name: "app",
    source: {
      type: "github",
      project: "APP",
      repo: REPO,
      assignee: "igor",
      triageApproval: true,
      maxActive: 1,
      ignoreLabels: ["epic"],
      ...overrides,
    } as ProjectConfig["source"],
    statuses: statuses ?? { aberta: "todo", fechada: "done", "fabrica:backlog": "backlog" },
  });
}

const projects = (config: ProjectConfig): WebhookProject[] => [{ name: config.name, config }];

/** Issue como o GitHub a envia no payload de `issues`. */
function issue(overrides: Record<string, unknown> = {}) {
  return {
    number: 12,
    title: "Exportar relatório",
    body: "Descrição.\n\n- [ ] gera CSV\n- [x] valida cabeçalho\n- [ ] envia e-mail",
    state: "open",
    labels: [],
    ...overrides,
  };
}

function delivery(action: string, overrides: Record<string, unknown> = {}, repo = REPO) {
  return { action, issue: issue(overrides), repository: { full_name: repo } };
}

const emptyState = (tasks: QueuedTask[] = []): FactoryState => ({ daemonPaused: false, tasks });

let refs = 0;
const newRef = () => `ref${++refs}`;

/** Aplica um evento `issues` já parseado e devolve o estado resultante. */
function apply(
  state: FactoryState,
  config: ProjectConfig,
  action: string,
  overrides: Record<string, unknown> = {},
  repo = REPO,
) {
  const parsed = parseGitHubDelivery({
    event: "issues",
    deliveryId: `d-${action}-${Math.random()}`,
    body: delivery(action, overrides, repo),
  });
  if (parsed.kind !== "issues") throw new Error(`esperava issues, veio ${parsed.kind}`);
  return applyIssueDelivery({ state, delivery: parsed.delivery, projects: projects(config), newRef });
}

const queued = (overrides: Partial<QueuedTask> = {}): QueuedTask =>
  ({
    id: "app/APP-12",
    project: "app",
    key: "APP-12",
    title: "título antigo",
    ref: "r0",
    status: "enfileirada",
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
    ...overrides,
  }) as QueuedTask;

describe("parseGitHubDelivery", () => {
  it("reconhece issues.opened e devolve a issue, o repositório e o identificador da entrega", () => {
    const parsed = parseGitHubDelivery({ event: "issues", deliveryId: "abc", body: delivery("opened") });
    expect(parsed).toMatchObject({
      kind: "issues",
      delivery: { deliveryId: "abc", action: "opened", repo: REPO, issue: { number: 12, title: "Exportar relatório" } },
    });
  });

  it("ignora eventos que a fábrica não trata neste passo", () => {
    expect(parseGitHubDelivery({ event: "ping", deliveryId: "p", body: {} }).kind).toBe("ignorado");
    expect(parseGitHubDelivery({ event: "push", deliveryId: "p", body: {} }).kind).toBe("ignorado");
  });

  it("ignora ações de issues fora do escopo (ex.: labeled)", () => {
    expect(parseGitHubDelivery({ event: "issues", deliveryId: "x", body: delivery("labeled") }).kind).toBe("ignorado");
  });

  it("recusa payload sem os campos essenciais", () => {
    const body = { action: "opened", issue: { title: "sem número" } };
    expect(parseGitHubDelivery({ event: "issues", deliveryId: "x", body }).kind).toBe("invalido");
    expect(parseGitHubDelivery({ event: "issues", deliveryId: undefined, body: delivery("opened") }).kind).toBe(
      "invalido",
    );
  });

  it("aceita o schema real de config: o projeto de teste é válido", () => {
    expect(ProjectConfigSchema.safeParse(githubProject()).success).toBe(true);
  });
});

describe("applyIssueDelivery: criação", () => {
  it("cria a Tarefa enfileirada quando a issue aberta é elegível", () => {
    const config = githubProject();
    const state = emptyState();
    const effects = apply(state, config, "opened");
    expect(effects).toEqual([]);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({
      id: "app/APP-12",
      project: "app",
      key: "APP-12",
      title: "Exportar relatório",
      status: "enfileirada",
      startedIn: "todo",
      ref: expect.any(String),
    });
  });

  it("guarda o escopo: descrição e contagem de checkboxes de aceite", () => {
    const state = emptyState();
    apply(state, githubProject(), "opened");
    expect(state.tasks[0]?.scope).toEqual({
      description: "Descrição.\n\n- [ ] gera CSV\n- [x] valida cabeçalho\n- [ ] envia e-mail",
      checkboxes: { done: 1, total: 3 },
    });
  });

  it("é idempotente: a mesma issue aberta duas vezes gera uma Tarefa só", () => {
    const config = githubProject();
    const state = emptyState();
    apply(state, config, "opened");
    apply(state, config, "opened");
    expect(state.tasks).toHaveLength(1);
  });

  it("não cria Tarefa para repositório que não está plugado", () => {
    const state = emptyState();
    apply(state, githubProject(), "opened", {}, "outra/coisa");
    expect(state.tasks).toEqual([]);
  });

  it("compara o repositório sem diferenciar caixa", () => {
    const state = emptyState();
    apply(state, githubProject(), "opened", {}, "ACME/App");
    expect(state.tasks).toHaveLength(1);
  });

  it("não cria Tarefa para pull request, épico, issue com sub-issues ou fora do status elegível", () => {
    const config = githubProject();
    const cases: [string, Record<string, unknown>][] = [
      ["pull request", { pull_request: { url: "x" } }],
      ["épico por label", { labels: [{ name: "epic" }] }],
      ["com sub-issues", { sub_issues_summary: { total: 2 } }],
    ];
    for (const [, overrides] of cases) {
      const state = emptyState();
      apply(state, config, "opened", overrides);
      expect(state.tasks).toEqual([]);
    }
    const backlog = emptyState();
    apply(backlog, githubProject({}, { aberta: "backlog" }), "opened");
    expect(backlog.tasks).toEqual([]);
  });

  it("respeita a lista de chaves permitidas do projeto", () => {
    const state = emptyState();
    apply(state, githubProject({ keys: ["APP-1"] }), "opened");
    expect(state.tasks).toEqual([]);
  });

  it("uma issue fechada não cria Tarefa", () => {
    const state = emptyState();
    apply(state, githubProject(), "opened", { state: "closed" });
    expect(state.tasks).toEqual([]);
  });
});

describe("applyIssueDelivery: edição de escopo", () => {
  it("atualiza título e escopo de uma Tarefa não terminada, sem mudar o estado", () => {
    const state = emptyState([queued({ status: "aguardando-humano" })]);
    const effects = apply(state, githubProject(), "edited", { title: "Novo título", body: "- [x] único" });
    expect(effects).toEqual([]);
    expect(state.tasks[0]).toMatchObject({
      title: "Novo título",
      status: "aguardando-humano",
      scope: { description: "- [x] único", checkboxes: { done: 1, total: 1 } },
    });
  });

  it("não mexe numa Tarefa já terminal", () => {
    const state = emptyState([queued({ status: "concluida", title: "antigo" })]);
    apply(state, githubProject(), "edited", { title: "novo" });
    expect(state.tasks[0]?.title).toBe("antigo");
  });

  it("edição de issue que ainda não virou Tarefa pode criá-la, se agora for elegível", () => {
    const state = emptyState();
    apply(state, githubProject(), "edited", { labels: [{ name: "epic" }] });
    expect(state.tasks).toEqual([]);
    apply(state, githubProject(), "edited", { labels: [] });
    expect(state.tasks).toHaveLength(1);
  });
});

describe("applyIssueDelivery: fechamento, remoção e reabertura", () => {
  it("issue fechada cancela a Tarefa não iniciada, com o motivo", () => {
    const state = emptyState([queued()]);
    const effects = apply(state, githubProject(), "closed", { state: "closed" });
    expect(effects).toEqual([]);
    expect(state.tasks[0]).toMatchObject({ status: "cancelada", reason: "issue fechada no GitHub" });
  });

  it("issue removida cancela a Tarefa com motivo próprio", () => {
    const state = emptyState([queued()]);
    apply(state, githubProject(), "deleted", { state: "closed" });
    expect(state.tasks[0]).toMatchObject({ status: "cancelada", reason: "issue removida no GitHub" });
  });

  it("Tarefa com execução durável pede a parada (efeito), como o cancelamento do usuário", () => {
    const state = emptyState([queued({ status: "ativa", durableId: 7 })]);
    const effects = apply(state, githubProject(), "closed", { state: "closed" });
    expect(effects).toEqual([{ type: "abortar", id: "app/APP-12" }]);
    expect(state.tasks[0]?.status).toBe("ativa");
  });

  it("fechar uma issue sem Tarefa, ou com Tarefa terminal, não faz nada", () => {
    const none = emptyState();
    expect(apply(none, githubProject(), "closed", { state: "closed" })).toEqual([]);
    expect(none.tasks).toEqual([]);
    const done = emptyState([queued({ status: "concluida" })]);
    apply(done, githubProject(), "closed", { state: "closed" });
    expect(done.tasks[0]?.status).toBe("concluida");
  });

  it("reabrir a issue devolve à fila a Tarefa que o fechamento do GitHub cancelou", () => {
    const state = emptyState([queued({ status: "cancelada", reason: "issue fechada no GitHub" })]);
    apply(state, githubProject(), "reopened");
    expect(state.tasks[0]).toMatchObject({ status: "enfileirada", reason: null });
  });

  it("reabrir não ressuscita uma Tarefa cancelada por outro motivo", () => {
    const state = emptyState([queued({ status: "cancelada", reason: "cancelada pelo usuário" })]);
    apply(state, githubProject(), "reopened");
    expect(state.tasks[0]).toMatchObject({ status: "cancelada", reason: "cancelada pelo usuário" });
  });
});

describe("applyIssueDelivery: atribuição", () => {
  it("assigned e unassigned não mudam a fila (ADR-0014: toda issue aberta é do dono)", () => {
    const state = emptyState([queued()]);
    const before = JSON.stringify(state);
    expect(apply(state, githubProject(), "assigned", { assignees: [{ login: "outra" }] })).toEqual([]);
    expect(apply(state, githubProject(), "unassigned")).toEqual([]);
    expect(JSON.stringify(state)).toBe(before);
  });
});
