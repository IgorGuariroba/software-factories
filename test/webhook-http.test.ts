import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { IssueDelivery } from "../src/github-webhook.js";
import { startWebhookListener } from "../src/webhook-listener.js";

const SECRET = "segredo-do-app-de-teste";
const REPO = "dono/repo";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function issuesBody(action = "opened", number = 9): string {
  return JSON.stringify({
    action,
    issue: { number, title: "Exportar CSV", body: "corpo", state: "open", labels: [] },
    repository: { full_name: REPO },
  });
}

async function listen(overrides: { onIssues?: (d: IssueDelivery) => Promise<void>; maxBytes?: number } = {}) {
  const received: IssueDelivery[] = [];
  const listener = await startWebhookListener({
    port: 0,
    secret: SECRET,
    maxBytes: overrides.maxBytes,
    onIssues:
      overrides.onIssues ??
      (async (d) => {
        received.push(d);
      }),
  });
  close = listener.close;
  return { url: listener.url, received };
}

/** Envia um POST como o GitHub faria: corpo, evento, entrega e assinatura. */
function post(url: string, body: string, headers: Record<string, string> = {}) {
  return fetch(`${url}/webhooks/github`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issues",
      "x-github-delivery": "entrega-1",
      "x-hub-signature-256": sign(body),
      ...headers,
    },
    body,
  });
}

describe("receptor do webhook do GitHub", () => {
  it("não sobe sem secret: falha fechado", async () => {
    await expect(startWebhookListener({ port: 0, secret: "", onIssues: async () => {} })).rejects.toThrow(/secret/);
  });

  it("aceita issues assinada e entrega a issue interpretada, com 202", async () => {
    const { url, received } = await listen();
    const res = await post(url, issuesBody("opened", 9));
    expect(res.status).toBe(202);
    expect(received).toEqual([
      expect.objectContaining({
        deliveryId: "entrega-1",
        action: "opened",
        repo: REPO,
        issue: expect.objectContaining({ number: 9, title: "Exportar CSV" }),
      }),
    ]);
  });

  it("recusa sem assinatura, com assinatura errada ou de outro secret, sem entregar nada", async () => {
    const { url, received } = await listen();
    const body = issuesBody();
    const none = await fetch(`${url}/webhooks/github`, {
      method: "POST",
      headers: { "x-github-event": "issues", "x-github-delivery": "e" },
      body,
    });
    expect(none.status).toBe(401);
    const wrong = await post(url, body, { "x-hub-signature-256": sign(body, "outro") });
    expect(wrong.status).toBe(401);
    expect(received).toEqual([]);
  });

  it("assinatura calculada sobre outro corpo não vale para este", async () => {
    const { url, received } = await listen();
    const res = await post(url, issuesBody("opened", 9), { "x-hub-signature-256": sign(issuesBody("opened", 10)) });
    expect(res.status).toBe(401);
    expect(received).toEqual([]);
  });

  it("responde 200 ao ping do GitHub, sem entregar nada", async () => {
    const { url, received } = await listen();
    const body = JSON.stringify({ zen: "ok" });
    const res = await post(url, body, { "x-github-event": "ping" });
    expect(res.status).toBe(200);
    expect(received).toEqual([]);
  });

  it("evento que a fábrica não trata recebe 202 e não é entregue", async () => {
    const { url, received } = await listen();
    const res = await post(url, JSON.stringify({ ref: "main" }), { "x-github-event": "push" });
    expect(res.status).toBe(202);
    expect(received).toEqual([]);
  });

  it("payload de issues incompleto, já assinado, recebe 400", async () => {
    const { url, received } = await listen();
    const res = await post(url, JSON.stringify({ action: "opened", issue: { title: "sem número" } }));
    expect(res.status).toBe(400);
    expect(received).toEqual([]);
  });

  it("recusa corpo acima do limite com 413, antes de ler tudo", async () => {
    const { url, received } = await listen({ maxBytes: 64 });
    const res = await post(url, issuesBody().padEnd(500, " "));
    expect(res.status).toBe(413);
    expect(received).toEqual([]);
  });

  it("falha no processamento responde 500 para o GitHub reenviar, sem vazar o secret", async () => {
    const { url } = await listen({
      onIssues: async () => {
        throw new Error(`falhou com ${SECRET}`);
      },
    });
    const res = await post(url, issuesBody());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(SECRET);
  });

  it("só existe a rota do webhook: outros caminhos e métodos são recusados", async () => {
    const { url } = await listen();
    expect((await fetch(`${url}/`)).status).toBe(404);
    expect((await fetch(`${url}/tasks`, { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(`${url}/webhooks/github`)).status).toBe(405);
  });
});
