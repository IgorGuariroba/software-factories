import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import type { FactoryState, QueuedTask } from "../src/durable.js";
import {
  applyInstallationDelivery,
  applyIssueDelivery,
  parseGitHubDelivery,
  type WebhookProject,
} from "../src/github-webhook.js";
import { desativarProjeto, repoDesativado } from "../src/repositorios.js";
import { testProjectConfig } from "./harness.js";

const REPO = "dono/repo";

function github(repo = REPO, project = "SF"): ProjectConfig {
  return testProjectConfig({
    name: "exemplo",
    source: {
      type: "github",
      project,
      repo,
      assignee: "igor",
      triageApproval: false,
      maxActive: 1,
      ignoreLabels: ["epic"],
    },
    statuses: { aberta: "todo", fechada: "done" },
  });
}

const projects = (config: ProjectConfig): WebhookProject[] => [{ name: config.name, config }];

const taskIn = (status: QueuedTask["status"], extra: Partial<QueuedTask> = {}): QueuedTask =>
  ({
    id: "exemplo/SF-7",
    project: "exemplo",
    key: "SF-7",
    title: "t",
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
    ...extra,
  }) as QueuedTask;

function installation(body: Record<string, unknown>, event = "installation") {
  const parsed = parseGitHubDelivery({ event, deliveryId: "d-inst", body });
  if (parsed.kind !== "instalacao") throw new Error(`esperava instalacao, veio ${parsed.kind}`);
  return parsed.delivery;
}

describe("parse de instalação e de repositórios da instalação", () => {
  it("installation.created traz o id e os repositórios da instalação", () => {
    const d = installation({
      action: "created",
      installation: { id: 42 },
      repositories: [{ full_name: REPO }],
    });
    expect(d).toMatchObject({ action: "created", installationId: 42, repos: [REPO] });
  });

  it("installation_repositories.removed lê os repositórios removidos", () => {
    const d = installation(
      { action: "removed", installation: { id: 42 }, repositories_removed: [{ full_name: REPO }] },
      "installation_repositories",
    );
    expect(d).toMatchObject({ action: "removed", installationId: 42, repos: [REPO] });
  });

  it("installation.deleted e suspend são aceitos; ações novas do GitHub são ignoradas", () => {
    expect(installation({ action: "deleted", installation: { id: 42 } })).toMatchObject({ action: "deleted" });
    expect(installation({ action: "suspend", installation: { id: 42 } })).toMatchObject({ action: "suspend" });
    const other = parseGitHubDelivery({
      event: "installation",
      deliveryId: "x",
      body: { action: "new_permissions_accepted", installation: { id: 42 } },
    });
    expect(other.kind).toBe("ignorado");
  });

  it("sem id da instalação, o payload é inválido", () => {
    const parsed = parseGitHubDelivery({ event: "installation", deliveryId: "x", body: { action: "deleted" } });
    expect(parsed.kind).toBe("invalido");
  });
});

describe("desativarProjeto: desplugar um repositório", () => {
  it("cancela as Tarefas não ativas com o motivo e marca o vínculo como desativado", () => {
    const state: FactoryState = { daemonPaused: false, tasks: [taskIn("enfileirada"), taskIn("aguardando-humano")] };
    const result = desativarProjeto({ state, project: "exemplo", repo: REPO, motivo: "desplugado", force: false });
    expect(state.tasks.map((t) => t.status)).toEqual(["cancelada", "cancelada"]);
    expect(state.tasks[0]?.reason).toBe("desplugado");
    expect(result.ativas).toEqual([]);
    expect(repoDesativado(state, "exemplo")).toBe(true);
  });

  it("Tarefa ativa sem force não é cancelada: é pausada e listada para confirmação", () => {
    const state: FactoryState = { daemonPaused: false, tasks: [taskIn("ativa", { durableId: 3 })] };
    const result = desativarProjeto({ state, project: "exemplo", repo: REPO, motivo: "desplugado", force: false });
    expect(result.ativas).toEqual(["exemplo/SF-7"]);
    expect(state.tasks[0]).toMatchObject({ status: "ativa", pauseRequested: true });
    expect(result.effects).toEqual([]);
  });

  it("com force, a Tarefa ativa é parada na execução durável (efeito), sem tocar no card", () => {
    const state: FactoryState = { daemonPaused: false, tasks: [taskIn("ativa", { durableId: 3 })] };
    const result = desativarProjeto({ state, project: "exemplo", repo: REPO, motivo: "desplugado", force: true });
    expect(result.ativas).toEqual([]);
    expect(result.effects).toEqual([{ type: "abortar", id: "exemplo/SF-7" }]);
  });

  it("Tarefas terminadas e as de outros projetos ficam como estão", () => {
    const other = taskIn("enfileirada", { id: "outro/SF-9", project: "outro", key: "SF-9" });
    const state: FactoryState = { daemonPaused: false, tasks: [taskIn("concluida"), other] };
    desativarProjeto({ state, project: "exemplo", repo: REPO, motivo: "desplugado", force: false });
    expect(state.tasks.map((t) => t.status)).toEqual(["concluida", "enfileirada"]);
  });
});

describe("repositório desativado bloqueia o caminho do webhook de issues", () => {
  it("issue aberta de um repositório desativado não vira Tarefa", () => {
    const config = github();
    const state: FactoryState = {
      daemonPaused: false,
      tasks: [],
      repos: { exemplo: { repo: REPO, status: "desativado" } },
    };
    const parsed = parseGitHubDelivery({
      event: "issues",
      deliveryId: "d-1",
      body: {
        action: "opened",
        issue: { number: 7, title: "x", body: "", state: "open", labels: [] },
        repository: { full_name: REPO },
      },
    });
    if (parsed.kind !== "issues") throw new Error("esperava issues");
    applyIssueDelivery({ state, delivery: parsed.delivery, projects: projects(config), newRef: () => "r" });
    expect(state.tasks).toEqual([]);
  });
});

describe("applyInstallationDelivery", () => {
  it("removido da instalação: desativa o projeto do repositório e avisa, com um aviso por projeto", () => {
    const config = github();
    const state: FactoryState = { daemonPaused: false, tasks: [taskIn("enfileirada")] };
    const effects = applyInstallationDelivery({
      state,
      delivery: installation(
        { action: "removed", installation: { id: 42 }, repositories_removed: [{ full_name: REPO }] },
        "installation_repositories",
      ),
      projects: projects(config),
    });
    expect(repoDesativado(state, "exemplo")).toBe(true);
    expect(state.tasks[0]?.status).toBe("cancelada");
    expect(effects).toEqual([
      expect.objectContaining({ type: "notificar", project: "exemplo", reason: "repositorio-desvinculado" }),
    ]);
  });

  it("added ou created reativam o projeto configurado e guardam a instalação de origem", () => {
    const config = github();
    const state: FactoryState = {
      daemonPaused: false,
      tasks: [],
      repos: { exemplo: { repo: REPO, status: "desativado" } },
    };
    const effects = applyInstallationDelivery({
      state,
      delivery: installation({ action: "created", installation: { id: 42 }, repositories: [{ full_name: REPO }] }),
      projects: projects(config),
    });
    expect(repoDesativado(state, "exemplo")).toBe(false);
    expect(state.repos?.exemplo?.installationId).toBe(42);
    expect(effects).toEqual([]);
  });

  it("repositório sem projeto configurado não é ativado: avisa para configurar o YAML", () => {
    const config = github();
    const state: FactoryState = { daemonPaused: false, tasks: [] };
    const effects = applyInstallationDelivery({
      state,
      delivery: installation(
        { action: "added", installation: { id: 42 }, repositories_added: [{ full_name: "outro/app" }] },
        "installation_repositories",
      ),
      projects: projects(config),
    });
    expect(state.repos).toBeUndefined();
    expect(effects).toEqual([expect.objectContaining({ type: "notificar", reason: "repo-sem-projeto" })]);
  });

  it("instalação removida ou suspensa desativa só os projetos dela", () => {
    const config = github();
    const state: FactoryState = {
      daemonPaused: false,
      tasks: [taskIn("enfileirada")],
      repos: { exemplo: { repo: REPO, status: "ativo", installationId: 42 } },
    };
    applyInstallationDelivery({
      state,
      delivery: installation({ action: "deleted", installation: { id: 42 } }),
      projects: projects(config),
    });
    expect(repoDesativado(state, "exemplo")).toBe(true);
    expect(state.tasks[0]?.status).toBe("cancelada");

    const outra: FactoryState = {
      daemonPaused: false,
      tasks: [],
      repos: { exemplo: { repo: REPO, status: "ativo", installationId: 99 } },
    };
    applyInstallationDelivery({
      state: outra,
      delivery: installation({ action: "suspend", installation: { id: 42 } }),
      projects: projects(config),
    });
    expect(repoDesativado(outra, "exemplo")).toBe(false);
  });
});
