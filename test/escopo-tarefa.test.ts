import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import type { Card } from "../src/demand-source.js";
import type { FactoryState, QueuedTask } from "../src/durable.js";
import { scopeGate } from "../src/durable.js";
import { applyIssueDelivery, parseGitHubDelivery, type WebhookProject } from "../src/github-webhook.js";
import { DEFAULT_SPEC, deliverSpec, FakeModel } from "./fakes/fake-model.js";
import { MemoryGitHubSource } from "./fakes/memory-github-source.js";
import {
  api,
  DEFAULT_DESCRIPTION,
  events,
  hold,
  poll,
  startTestFactory,
  type TestFactory,
  testProjectConfig,
  USER,
  waitForStatus,
} from "./harness.js";

// --- Helpers espelhados de test/triagem.test.ts (mesma configuração de repositório monitorado) ----

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
    statuses: { aberta: "todo", "em-andamento": "in_progress", "aguardando-teste": "waiting_test", fechada: "done" },
  };
}

const issue = (n: number, title = `Issue ${n}`): Card => ({
  key: `SF-${n}`,
  title,
  status: "aberta",
  assignee: USER,
  description: DEFAULT_DESCRIPTION,
});

/** Modelo que aceita toda issue na triagem e entrega a SPEC padrão. */
function accept(): FakeModel {
  const model = new FakeModel();
  model.respond = (call) =>
    call.tools.includes("entregar_triagem")
      ? fauxAssistantMessage(
          [fauxToolCall("entregar_triagem", { decisao: "aceita", categoria: "ok", motivo: "pedido claro" })],
          { stopReason: "toolUse" },
        )
      : deliverSpec(DEFAULT_SPEC);
  return model;
}

// --- Reducer: edição de escopo com Tarefa em execução (decisão D) ---------------------------------

const REPO = "dono/repo";
const config = testProjectConfig(github());
const projects: WebhookProject[] = [{ name: config.name, config }];

function delivery(action: string, overrides: Record<string, unknown> = {}) {
  const parsed = parseGitHubDelivery({
    event: "issues",
    deliveryId: `d-${action}`,
    body: {
      action,
      issue: { number: 7, title: "Exportar CSV", body: "- [ ] cabeçalho", state: "open", labels: [], ...overrides },
      repository: { full_name: REPO },
    },
  });
  if (parsed.kind !== "issues") throw new Error(`esperava issues, veio ${parsed.kind}`);
  return parsed.delivery;
}

const taskIn = (status: QueuedTask["status"], extra: Partial<QueuedTask> = {}): QueuedTask =>
  ({
    id: "exemplo/SF-7",
    project: "exemplo",
    key: "SF-7",
    title: "antigo",
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

const run = (state: FactoryState, action: string, overrides: Record<string, unknown> = {}) =>
  applyIssueDelivery({ state, delivery: delivery(action, overrides), projects, newRef: () => "novo" });

describe("reducer: edição com Tarefa em execução", () => {
  it("edição de Tarefa ativa marca o escopo como desatualizado, pede pausa e avisa o usuário", () => {
    const state: FactoryState = { daemonPaused: false, tasks: [taskIn("ativa", { durableId: 3 })] };
    const effects = run(state, "edited", { title: "Exportar CSV com cabeçalho" });
    expect(state.tasks[0]).toMatchObject({
      title: "Exportar CSV com cabeçalho",
      status: "ativa",
      specDirty: true,
      pauseRequested: true,
    });
    expect(effects).toEqual([
      {
        type: "notificar",
        project: "exemplo",
        target: "SF-7",
        reason: "escopo-alterado",
        message: expect.stringContaining("SF-7"),
      },
    ]);
  });

  it("Tarefa aguardando a entrega fica desatualizada e avisa, mas não pede pausa", () => {
    const state: FactoryState = { daemonPaused: false, tasks: [taskIn("aguardando-entrega")] };
    const effects = run(state, "edited");
    expect(state.tasks[0]).toMatchObject({ specDirty: true, pauseRequested: false, status: "aguardando-entrega" });
    expect(effects).toHaveLength(1);
  });

  it.each(["enfileirada", "pausada", "aguardando-humano", "aguardando-veto"] as const)(
    "Tarefa %s só atualiza o escopo, em silêncio",
    (status) => {
      const state: FactoryState = { daemonPaused: false, tasks: [taskIn(status)] };
      const effects = run(state, "edited", { title: "novo" });
      expect(state.tasks[0]?.title).toBe("novo");
      expect(state.tasks[0]?.specDirty).toBeFalsy();
      expect(effects).toEqual([]);
    },
  );

  it("fechar uma Tarefa ativa não conta como mudança de escopo", () => {
    const state: FactoryState = { daemonPaused: false, tasks: [taskIn("ativa", { durableId: 3 })] };
    run(state, "closed", { state: "closed" });
    expect(state.tasks[0]?.specDirty).toBeFalsy();
  });
});

// --- Barreira no limite de cada passo ---------------------------------------------------------------

describe("scopeGate: o que fazer com escopo alterado, por passo", () => {
  const dirty = { specDirty: true, implementation: null };

  it("sem mudança de escopo, todo passo segue", () => {
    expect(scopeGate({ specDirty: false, implementation: null }, "implementar")).toBe("seguir");
  });

  it("passos antes da SPEC seguem: a SPEC que vier lê o card atual", () => {
    for (const step of ["triar", "retro-triagem", "comentar", "transicionar", "spec"] as const) {
      expect(scopeGate(dirty, step)).toBe("seguir");
    }
  });

  it("depois da SPEC e antes de qualquer código, refaz a SPEC", () => {
    expect(scopeGate(dirty, "retro-spec")).toBe("refazer-spec");
    expect(scopeGate(dirty, "implementar")).toBe("refazer-spec");
  });

  it("com implementação já iniciada, bloqueia: a SPEC antiga não pode ser trocada no meio dos commits", () => {
    const started = { specDirty: true, implementation: {} as QueuedTask["implementation"] };
    expect(scopeGate(started, "implementar")).toBe("bloquear");
    expect(scopeGate(started, "revisar")).toBe("bloquear");
  });
});

// --- Fluxo de ponta a ponta: Tarefa segurada no meio da execução ----------------------------------

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

/** Segura o comentário "Assumindo" do card até o teste soltar: a Tarefa fica ativa num passo intermediário. */
function holdAssume(f: TestFactory, key: string) {
  const h = hold();
  const addComment = f.source.addComment.bind(f.source);
  f.source.addComment = async (k, body) => {
    if (k === key) await h.promise;
    return addComment(k, body);
  };
  return h;
}

/**
 * Segura a escrita do comentário Tickets: a SPEC já foi entregue com o texto antigo e a Tarefa ainda está ativa, no
 * intervalo em que a mudança de escopo ainda precisa refazê-la. `reached` avisa que a espera começou.
 */
function holdTicketsWrite(f: TestFactory, key: string) {
  const h = hold();
  let reachedNow!: () => void;
  const reached = new Promise<void>((resolve) => {
    reachedNow = resolve;
  });
  const addComment = f.source.addComment.bind(f.source);
  f.source.addComment = async (k, body) => {
    if (k === key && body.startsWith("Tickets")) {
      reachedNow();
      await h.promise;
    }
    return addComment(k, body);
  };
  return { reached, release: h.release };
}

/** Texto novo do card: acima do mínimo de 80 caracteres, para não cair na regra de card raso (pergunta ao PO). */
const TEXTO_NOVO = `${DEFAULT_DESCRIPTION}\n\n- [ ] cabeçalho`;

describe("edição com Tarefa ativa, ponta a ponta", () => {
  it("pausa a Tarefa no próximo passo, avisa uma vez e, ao retomar, conclui com o escopo novo", async () => {
    const source = new MemoryGitHubSource([issue(7, "Exportar CSV")]);
    factory = await startTestFactory({ source, model: accept(), config: github() });
    const held = holdAssume(factory, "SF-7");
    await poll(factory);
    await waitForStatus(factory, "SF-7", "ativa");

    // O GitHub já tem o texto novo quando o webhook chega.
    const card = source.cards.find((c) => c.key === "SF-7");
    if (!card) throw new Error("card SF-7 ausente na Fonte de teste");
    card.title = "Exportar CSV com cabeçalho";
    card.description = TEXTO_NOVO;
    const parsed = parseGitHubDelivery({
      event: "issues",
      deliveryId: "entrega-edicao-1",
      body: {
        action: "edited",
        issue: { number: 7, title: "Exportar CSV com cabeçalho", body: TEXTO_NOVO, state: "open", labels: [] },
        repository: { full_name: "dono/repo" },
      },
    });
    if (parsed.kind !== "issues") throw new Error("entrega não reconhecida");
    await factory.applyGitHubDelivery(parsed.delivery);
    held.release();

    await waitForStatus(factory, "SF-7", "pausada");
    const notices = (await events(factory)).filter((e) => e.type === "notify" && e.reason === "escopo-alterado");
    expect(notices).toHaveLength(1);

    await api(factory, "POST", "/tasks/exemplo/SF-7/resume");
    await waitForStatus(factory, "SF-7", "concluida");
    // A SPEC foi montada com o card atual, não com o texto que a Tarefa tinha antes da edição.
    expect(factory.model.calls.some((c) => c.input.includes("- [ ] cabeçalho"))).toBe(true);
    expect(factory.model.calls.some((c) => c.input.includes("Exportar CSV com cabeçalho"))).toBe(true);
  });

  it("edição durante a SPEC: a SPEC é refeita com o texto novo antes de qualquer código", async () => {
    const source = new MemoryGitHubSource([issue(7, "Exportar CSV")]);
    factory = await startTestFactory({ source, model: accept(), config: github() });
    const specHeld = holdTicketsWrite(factory, "SF-7");
    await poll(factory);
    await specHeld.reached;

    // A SPEC antiga já foi entregue; a Tarefa ainda está no meio da etapa.
    const card = source.cards.find((c) => c.key === "SF-7");
    if (!card) throw new Error("card SF-7 ausente na Fonte de teste");
    card.title = "Exportar CSV com cabeçalho";
    card.description = TEXTO_NOVO;
    const parsed = parseGitHubDelivery({
      event: "issues",
      deliveryId: "entrega-edicao-spec",
      body: {
        action: "edited",
        issue: { number: 7, title: card.title, body: TEXTO_NOVO, state: "open", labels: [] },
        repository: { full_name: "dono/repo" },
      },
    });
    if (parsed.kind !== "issues") throw new Error("entrega não reconhecida");
    await factory.applyGitHubDelivery(parsed.delivery);
    specHeld.release();

    // A Tarefa estava ativa: pausa no próximo passo, como na edição durante a execução.
    await waitForStatus(factory, "SF-7", "pausada");
    await api(factory, "POST", "/tasks/exemplo/SF-7/resume");
    await waitForStatus(factory, "SF-7", "concluida");

    // A SPEC refeita foi montada com o card novo: é a única que o modelo recebeu com o texto atual.
    const specCalls = factory.model.calls.filter((c) => c.tools.includes("entregar_spec"));
    expect(specCalls.length).toBeGreaterThanOrEqual(2);
    expect(specCalls.at(-1)?.input).toContain("Exportar CSV com cabeçalho");
  });
});
