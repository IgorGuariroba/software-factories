import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import type { FactoryState, QueuedTask } from "../src/durable.js";
import { applyIssueDelivery, parseGitHubDelivery, type WebhookProject } from "../src/github-webhook.js";

const config = {
  name: "SF",
  source: {
    type: "github",
    project: "SF",
    repo: "dono/repo",
    assignee: "dono",
    triageApproval: false,
    maxActive: 1,
    ignoreLabels: ["epic"],
  },
  statuses: { aberta: "todo", fechada: "done" },
} as unknown as ProjectConfig;
const projetos: WebhookProject[] = [{ name: "SF", config }];

const REPO_ID = 555;

/** Entrega de issue como o GitHub a envia (payload mínimo com ids). */
function entrega(
  action: string,
  number: number,
  opts: { repo?: string; repoId?: number; deliveryId?: string; titulo?: string } = {},
) {
  return parseGitHubDelivery({
    event: "issues",
    deliveryId: opts.deliveryId ?? `d-${action}-${number}-${Math.random()}`,
    body: {
      action,
      issue: {
        id: 9000 + number,
        number,
        title: opts.titulo ?? `Issue ${number}`,
        body: "",
        state: action === "closed" ? "closed" : "open",
        labels: [],
      },
      repository: { full_name: opts.repo ?? "dono/repo", id: opts.repoId ?? REPO_ID },
      installation: { id: 77 },
    },
  });
}

function aplicar(state: FactoryState, parsed: ReturnType<typeof entrega>) {
  if (parsed.kind !== "issues") throw new Error(`entrega inválida: ${JSON.stringify(parsed)}`);
  return applyIssueDelivery({ state, delivery: parsed.delivery, projects: projetos, newRef: () => "ref" });
}

const estado = (over: Partial<FactoryState> = {}): FactoryState => ({ daemonPaused: false, tasks: [], ...over });

describe("parse: a entrega carrega os ids estáveis", () => {
  it("guarda o id do repositório, o id da instalação e o id da issue", () => {
    const parsed = entrega("opened", 4, { repoId: 123 });
    expect(parsed).toMatchObject({
      kind: "issues",
      delivery: { repoId: 123, installationId: 77, issue: { id: 9004 } },
    });
  });
});

describe("criação e reentrega pelo webhook", () => {
  it("issue aberta cria Tarefa já com a origem GitHub", () => {
    const state = estado();
    aplicar(state, entrega("opened", 1, { repoId: REPO_ID }));
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]?.origem).toEqual({
      repoId: REPO_ID,
      repo: "dono/repo",
      issueId: 9001,
      issueNumber: 1,
      installationId: 77,
    });
  });

  it("reentregar 'opened' não duplica a Tarefa", () => {
    const state = estado();
    aplicar(state, entrega("opened", 1, { repoId: REPO_ID }));
    aplicar(state, entrega("opened", 1, { repoId: REPO_ID }));
    expect(state.tasks).toHaveLength(1);
  });

  it("a primeira entrega grava o id do repositório no vínculo do projeto", () => {
    const state = estado();
    aplicar(state, entrega("opened", 1, { repoId: REPO_ID }));
    expect(state.repos?.SF).toMatchObject({ repoId: REPO_ID, status: "ativo" });
  });
});

describe("renomeação do repositório", () => {
  it("entrega com o nome novo é do mesmo projeto, sem duplicar, e avisa para atualizar o YAML", () => {
    const state = estado();
    aplicar(state, entrega("opened", 1, { repoId: REPO_ID }));
    const efeitos = aplicar(state, entrega("edited", 1, { repo: "dono/novo-nome", repoId: REPO_ID }));
    expect(state.tasks).toHaveLength(1);
    expect(efeitos).toEqual([
      expect.objectContaining({ type: "notificar", reason: "repositorio-renomeado", project: "SF" }),
    ]);
  });

  it("depois de renomear, uma issue nova ainda entra pelo mesmo projeto", () => {
    const state = estado();
    aplicar(state, entrega("opened", 1, { repoId: REPO_ID }));
    aplicar(state, entrega("opened", 2, { repo: "dono/novo-nome", repoId: REPO_ID }));
    expect(state.tasks.map((t) => t.id)).toEqual(["SF/SF-1", "SF/SF-2"]);
  });

  it("repositório desativado continua bloqueado mesmo com o id conhecido", () => {
    const state = estado({ repos: { SF: { repo: "dono/repo", status: "desativado", repoId: REPO_ID } } });
    aplicar(state, entrega("opened", 1, { repoId: REPO_ID }));
    expect(state.tasks).toEqual([]);
  });
});

describe("Tarefa legada e identidade diferente", () => {
  it("Tarefa da busca antiga (sem origem) recebe a origem ao primeiro evento, sem duplicar", () => {
    const legada = {
      id: "SF/SF-5",
      project: "SF",
      key: "SF-5",
      title: "antiga",
      status: "enfileirada",
    } as unknown as QueuedTask;
    const state = estado({ tasks: [legada] });
    aplicar(state, entrega("edited", 5, { repoId: REPO_ID }));
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]?.origem?.issueNumber).toBe(5);
  });

  it("Tarefa com a mesma chave mas de outro repositório não é tocada por evento deste repositório", () => {
    const outra = {
      id: "SF/SF-3",
      project: "SF",
      key: "SF-3",
      title: "de outro repo",
      status: "enfileirada",
      origem: { repoId: 999, repo: "outro/x", issueId: 1, issueNumber: 3 },
    } as unknown as QueuedTask;
    const state = estado({ tasks: [outra] });
    aplicar(state, entrega("closed", 3, { repoId: REPO_ID }));
    aplicar(state, entrega("edited", 3, { repoId: REPO_ID, titulo: "não deve aparecer" }));
    expect(state.tasks[0]?.status).toBe("enfileirada");
    expect(state.tasks[0]?.title).toBe("de outro repo");
  });

  it("fechamento cancela a Tarefa de origem conhecida e reabertura a devolve à fila", () => {
    const state = estado();
    aplicar(state, entrega("opened", 1, { repoId: REPO_ID }));
    aplicar(state, entrega("closed", 1, { repoId: REPO_ID }));
    expect(state.tasks[0]?.status).toBe("cancelada");
    aplicar(state, entrega("reopened", 1, { repoId: REPO_ID }));
    expect(state.tasks[0]?.status).toBe("enfileirada");
  });
});
