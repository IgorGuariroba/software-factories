import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import { MemoryGitHubSource } from "./fakes/memory-github-source.js";
import { api, DEFAULT_DESCRIPTION, startTestFactory, statusOf, type TestFactory, USER } from "./harness.js";

const SECRET = "segredo-do-app-de-teste";

const github = (): Partial<ProjectConfig> => ({
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
});

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

/** Entrega do GitHub para a rota do webhook, com a assinatura do secret configurado na fábrica. */
function deliver(f: TestFactory, deliveryId: string, action: string, number = 7, state = "open") {
  const body = JSON.stringify({
    action,
    issue: { number, title: `Issue ${number}`, body: DEFAULT_DESCRIPTION, state, labels: [] },
    repository: { full_name: "dono/repo" },
  });
  return fetch(`${f.webhookUrl}/webhooks/github`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issues",
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": sign(body),
    },
    body,
  });
}

describe("webhook do GitHub dentro da fábrica", () => {
  it("issue aberta entregue e assinada vira Tarefa enfileirada", async () => {
    factory = await startTestFactory({
      source: new MemoryGitHubSource([]),
      config: github(),
      webhookSecret: SECRET,
    });
    await api(factory, "POST", "/daemon/pause");

    expect((await deliver(factory, "d-1", "opened")).status).toBe(202);
    expect(await statusOf(factory, "SF-7")).toBe("enfileirada");
  });

  it("entrega sem assinatura válida não muda o estado", async () => {
    factory = await startTestFactory({ source: new MemoryGitHubSource([]), config: github(), webhookSecret: SECRET });
    await api(factory, "POST", "/daemon/pause");
    const res = await fetch(`${factory.webhookUrl}/webhooks/github`, {
      method: "POST",
      headers: { "x-github-event": "issues", "x-github-delivery": "d-x", "x-hub-signature-256": "sha256=00" },
      body: JSON.stringify({
        action: "opened",
        issue: { number: 7, title: "x", state: "open" },
        repository: { full_name: "dono/repo" },
      }),
    });
    expect(res.status).toBe(401);
    expect(await statusOf(factory, "SF-7")).toBeUndefined();
  });

  it("reenvio de uma entrega já aplicada não refaz a mudança", async () => {
    factory = await startTestFactory({ source: new MemoryGitHubSource([]), config: github(), webhookSecret: SECRET });
    await api(factory, "POST", "/daemon/pause");

    await deliver(factory, "d-open", "opened");
    await deliver(factory, "d-closed", "closed", 7, "closed");
    expect(await statusOf(factory, "SF-7")).toBe("cancelada");
    await deliver(factory, "d-reopened", "reopened");
    expect(await statusOf(factory, "SF-7")).toBe("enfileirada");

    // O GitHub reenvia o fechamento (mesma entrega): sem deduplicar, ele cancelaria a Tarefa de novo.
    expect((await deliver(factory, "d-closed", "closed", 7, "closed")).status).toBe(202);
    expect(await statusOf(factory, "SF-7")).toBe("enfileirada");
  });

  it("sem secret configurado, a fábrica não abre o receptor", async () => {
    factory = await startTestFactory({ source: new MemoryGitHubSource([]), config: github() });
    expect(factory.webhookUrl).toBeUndefined();
  });
});
