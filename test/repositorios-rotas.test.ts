import { createHmac } from "node:crypto";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import type { Card } from "../src/demand-source.js";
import { DEFAULT_SPEC, deliverSpec, FakeModel } from "./fakes/fake-model.js";
import { MemoryGitHubSource } from "./fakes/memory-github-source.js";
import {
  api,
  DEFAULT_DESCRIPTION,
  events,
  eventually,
  hold,
  poll,
  startTestFactory,
  statusOf,
  type TestFactory,
  USER,
  waitForStatus,
} from "./harness.js";

const SECRET = "segredo-do-app-de-teste";

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
      ? fauxAssistantMessage([fauxToolCall("entregar_triagem", { decisao: "aceita", categoria: "ok", motivo: "ok" })], {
          stopReason: "toolUse",
        })
      : deliverSpec(DEFAULT_SPEC);
  return model;
}

/** Segura o comentário "Assumindo" do card: a Tarefa fica ativa num passo intermediário. */
function holdAssume(f: TestFactory, key: string) {
  const h = hold();
  const addComment = f.source.addComment.bind(f.source);
  f.source.addComment = async (k, body) => {
    if (k === key) await h.promise;
    return addComment(k, body);
  };
  return h;
}

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const post = (f: TestFactory, path: string, body: unknown) =>
  fetch(`${f.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const listRepos = (f: TestFactory) =>
  api<{ project: string; repo: string; status: string; installationId: number | null }[]>(f, "GET", "/repos");

describe("rotas de repositórios", () => {
  it("lista o repositório monitorado como ativo", async () => {
    factory = await startTestFactory({ source: new MemoryGitHubSource([]), config: github() });
    expect(await listRepos(factory)).toEqual([
      expect.objectContaining({ project: "exemplo", repo: "dono/repo", status: "ativo", installationId: null }),
    ]);
  });

  it("desplugar cancela a Tarefa não iniciada e a fila não traz mais cards do repositório", async () => {
    const source = new MemoryGitHubSource([issue(7)]);
    factory = await startTestFactory({ source, model: accept(), config: github() });
    await api(factory, "POST", "/daemon/pause");
    await poll(factory);
    expect(await statusOf(factory, "SF-7")).toBe("enfileirada");

    const res = await post(factory, "/repos/desplugar", { repo: "dono/repo" });
    expect(res.status).toBe(200);
    expect(await statusOf(factory, "SF-7")).toBe("cancelada");
    expect((await listRepos(factory))[0]?.status).toBe("desativado");

    source.cards.push(issue(8));
    await api(factory, "POST", "/daemon/resume");
    await poll(factory);
    expect(await statusOf(factory, "SF-8")).toBeUndefined();
  });

  it("desplugar com Tarefa em execução recusa com 409 e não muda nada, sem force", async () => {
    const source = new MemoryGitHubSource([issue(7)]);
    factory = await startTestFactory({ source, model: accept(), config: github() });
    const held = holdAssume(factory, "SF-7");
    await poll(factory);
    await waitForStatus(factory, "SF-7", "ativa");

    const res = await post(factory, "/repos/desplugar", { repo: "dono/repo" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ tarefasAtivas: ["exemplo/SF-7"] });
    expect(await statusOf(factory, "SF-7")).toBe("ativa");
    expect((await listRepos(factory))[0]?.status).toBe("ativo");
    held.release();
  });

  it("com force, a Tarefa em execução é cancelada e o repositório fica desativado", async () => {
    const source = new MemoryGitHubSource([issue(7)]);
    factory = await startTestFactory({ source, model: accept(), config: github() });
    const held = holdAssume(factory, "SF-7");
    await poll(factory);
    await waitForStatus(factory, "SF-7", "ativa");

    const res = await post(factory, "/repos/desplugar", { repo: "dono/repo", force: true });
    expect(res.status).toBe(200);
    held.release();
    const f = factory;
    await eventually(async () => expect(await statusOf(f, "SF-7")).toBe("cancelada"));
    expect((await listRepos(factory))[0]?.status).toBe("desativado");
  });

  it("replugar reativa o repositório e a próxima busca volta a enfileirar os cards", async () => {
    const source = new MemoryGitHubSource([issue(7)]);
    factory = await startTestFactory({ source, model: accept(), config: github() });
    await api(factory, "POST", "/daemon/pause");
    await post(factory, "/repos/desplugar", { repo: "dono/repo" });

    const res = await post(factory, "/repos/plugar", { repo: "dono/repo" });
    expect(res.status).toBe(200);
    expect((await listRepos(factory))[0]?.status).toBe("ativo");
    await poll(factory);
    expect(await statusOf(factory, "SF-7")).toBe("enfileirada");
  });

  it("repositório desconhecido recebe 404 e corpo sem repositório recebe 400", async () => {
    factory = await startTestFactory({ source: new MemoryGitHubSource([]), config: github() });
    expect((await post(factory, "/repos/desplugar", { repo: "outro/app" })).status).toBe(404);
    expect((await post(factory, "/repos/plugar", { repo: "outro/app" })).status).toBe(404);
    expect((await post(factory, "/repos/desplugar", { repo: "não é um repo" })).status).toBe(400);
  });

  it("replugar um repositório sem projeto configurado recebe 404: a config fica no YAML", async () => {
    factory = await startTestFactory({ source: new MemoryGitHubSource([]), config: github() });
    expect((await post(factory, "/repos/plugar", { repo: "dono/novo" })).status).toBe(404);
  });
});

describe("eventos de instalação do App", () => {
  it("removido da instalação desativa o repositório, cancela a fila e avisa uma vez", async () => {
    factory = await startTestFactory({
      source: new MemoryGitHubSource([issue(7)]),
      config: github(),
      webhookSecret: SECRET,
    });
    await api(factory, "POST", "/daemon/pause");
    await poll(factory);

    const body = JSON.stringify({
      action: "removed",
      installation: { id: 42 },
      repositories_removed: [{ full_name: "dono/repo" }],
    });
    const res = await fetch(`${factory.webhookUrl}/webhooks/github`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "installation_repositories",
        "x-github-delivery": "inst-1",
        "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`,
      },
      body,
    });
    expect(res.status).toBe(202);
    expect(await statusOf(factory, "SF-7")).toBe("cancelada");
    expect((await listRepos(factory))[0]?.status).toBe("desativado");
    const notices = (await events(factory)).filter(
      (e) => e.type === "notify" && e.reason === "repositorio-desvinculado",
    );
    expect(notices).toHaveLength(1);
  });

  it("removido com Tarefa em execução: pausa a Tarefa, e retomá-la não a põe para rodar", async () => {
    const source = new MemoryGitHubSource([issue(7)]);
    factory = await startTestFactory({ source, model: accept(), config: github(), webhookSecret: SECRET });
    const held = holdAssume(factory, "SF-7");
    await poll(factory);
    await waitForStatus(factory, "SF-7", "ativa");

    const body = JSON.stringify({
      action: "removed",
      installation: { id: 42 },
      repositories_removed: [{ full_name: "dono/repo" }],
    });
    await fetch(`${factory.webhookUrl}/webhooks/github`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "installation_repositories",
        "x-github-delivery": "inst-ativa",
        "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`,
      },
      body,
    });
    held.release();
    await waitForStatus(factory, "SF-7", "pausada");

    await api(factory, "POST", "/tasks/exemplo/SF-7/resume");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await statusOf(factory, "SF-7")).not.toBe("ativa");
    expect(await statusOf(factory, "SF-7")).not.toBe("concluida");
  });
});
