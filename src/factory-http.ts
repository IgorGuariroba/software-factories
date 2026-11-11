import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createApiLocal, type criarRotasApi } from "./packages/api-local/index.js";
import { RepairConflict } from "./repair.js";
import { redactSecrets } from "./secrets.js";
import { webFile } from "./web.js";

// Servidor HTTP local da fábrica: a API e a página de gestão. As guardas (só clientes locais, Host e Origin) e as rotas
// são do adaptador api-local; aqui ficam só a ligação com o servidor e a escrita da resposta.

type Rotas = ReturnType<typeof criarRotasApi>;

/**
 * Cria o servidor (sem escutar ainda). `streams` guarda as respostas de evento (SSE) abertas, para o encerramento.
 * Só clientes locais: Host precisa ser localhost/127.0.0.1 na porta do servidor (barra DNS rebinding) e um POST com
 * Origin precisa vir dessas mesmas origens (barra CSRF de páginas abertas no navegador).
 */
export function criarServidorHttp(opts: { rotas: Rotas }): { server: Server; streams: Set<ServerResponse> } {
  const json = (res: ServerResponse, status: number, body: unknown) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(payload);
  };
  const readBody = async (req: IncomingMessage): Promise<unknown> => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : undefined;
  };
  const streams = new Set<ServerResponse>();

  const localHosts = () => {
    const { port } = server.address() as AddressInfo;
    return new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  };

  const api = createApiLocal({ hosts: localHosts, rotas: opts.rotas });

  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      // Guardas e rotas migradas: o adaptador responde tudo que casa com uma das rotas dele. A página de gestão passa
      // pelas mesmas guardas (só clientes locais).
      const tratado = await api.tratar({
        metodo: req.method ?? "",
        caminho: url.pathname,
        host: req.headers.host,
        origem: req.headers.origin,
        contentType: req.headers["content-type"],
        corpo: () => readBody(req),
      });
      if (tratado && "tipo" in tratado) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": conectado\n\n");
        streams.add(res);
        const desligar = tratado.assinar((dados) => res.write(`data: ${dados}\n\n`));
        req.on("close", () => {
          desligar();
          streams.delete(res);
        });
        return;
      }
      if (tratado) return json(res, tratado.status, tratado.body);
      const _route = `${req.method} ${url.pathname}`;

      const page = req.method === "GET" ? await webFile(url.pathname) : undefined;
      if (page) {
        res.writeHead(200, page.headers);
        res.end(page.body);
        return;
      }
      json(res, 404, { error: "rota inexistente" });
    } catch (err) {
      json(res, err instanceof RepairConflict ? 409 : 500, { error: redactSecrets(String(err)) });
    }
  });
  return { server, streams };
}
