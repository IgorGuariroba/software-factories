import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type InstallationDelivery,
  type IssueDelivery,
  parseGitHubDelivery,
  verifyGitHubSignature,
} from "./github-webhook.js";
import { redactSecrets } from "./secrets.js";

/** Único caminho que o receptor atende. */
export const WEBHOOK_PATH = "/webhooks/github";
/** Teto do corpo: uma issue do GitHub cabe folgada; acima disso, a entrega é recusada sem ser lida inteira. */
const DEFAULT_MAX_BYTES = 1024 * 1024;

export interface WebhookListenerOptions {
  /** Porta local (127.0.0.1). Um túnel encaminha o GitHub até ela; a API da fábrica continua só local. */
  port: number;
  /** Secret do GitHub App. Vazio = o receptor não sobe (falha fechado). */
  secret: string;
  /** Recebe cada entrega `issues` já validada. Uma exceção vira 500: a entrega fica como falha no GitHub. */
  onIssues: (delivery: IssueDelivery) => Promise<void>;
  /** Recebe eventos de instalação do App (repositórios que entram ou saem). Sem ele, são ignorados. */
  onInstallation?: (delivery: InstallationDelivery) => Promise<void>;
  maxBytes?: number;
}

export interface WebhookListener {
  url: string;
  close(): Promise<void>;
}

/**
 * Receptor dos webhooks do GitHub. Ordem das checagens: caminho e método, assinatura sobre os bytes crus, e só então o
 * JSON. Um corpo sem assinatura válida nunca chega ao parser nem ao estado.
 */
export async function startWebhookListener(opts: WebhookListenerOptions): Promise<WebhookListener> {
  if (!opts.secret) throw new Error("secret do webhook ausente: o receptor do GitHub não sobe sem ele");
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  const server = createServer(async (req, res) => {
    try {
      await handle(req, res, opts, maxBytes);
    } catch (err) {
      console.error("[fábrica] webhook do GitHub falhou:", redactSecrets(String(err)));
      send(res, 500, "erro interno ao processar a entrega");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  opts: WebhookListenerOptions,
  maxBytes: number,
): Promise<void> {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path !== WEBHOOK_PATH) return send(res, 404, "rota inexistente");
  if (req.method !== "POST") return send(res, 405, "use POST", { allow: "POST" });

  const raw = await readBody(req, maxBytes);
  if (raw === "too-large") return send(res, 413, "corpo grande demais", { connection: "close" });

  const signature = req.headers["x-hub-signature-256"];
  if (!verifyGitHubSignature({ secret: opts.secret, body: raw, signature: singular(signature) }))
    return send(res, 401, "assinatura inválida");

  const event = singular(req.headers["x-github-event"]);
  if (event === "ping") return send(res, 200, "pong");

  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return send(res, 400, "JSON inválido");
  }
  const parsed = parseGitHubDelivery({
    event,
    deliveryId: singular(req.headers["x-github-delivery"]),
    body,
  });
  if (parsed.kind === "invalido") return send(res, 400, parsed.reason);
  if (parsed.kind === "ignorado") return send(res, 202, parsed.reason);
  if (parsed.kind === "instalacao") {
    if (opts.onInstallation) await opts.onInstallation(parsed.delivery);
    return send(res, 202, "aceito");
  }
  await opts.onIssues(parsed.delivery);
  return send(res, 202, "aceito");
}

/** Lê o corpo cru até o limite. Estourar o limite não lê o resto: a resposta é 413 e a conexão fecha. */
async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | "too-large"> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) return "too-large";
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** Cabeçalho repetido não é uma entrega válida do GitHub: fica como ausente. */
function singular(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function send(res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers });
  res.end(text);
}
