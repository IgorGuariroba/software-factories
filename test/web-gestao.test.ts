import { readdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SPEC, deliverSpec, FakeModel } from "./fakes/fake-model.js";
import {
  api,
  eventually,
  hold,
  PO,
  poll,
  startTestFactory,
  type TestFactory,
  tasks,
  USER,
  waitForStatus,
} from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const card = (key: string, status = "A Fazer") => ({ key, title: `card ${key}`, status, assignee: USER });

describe("etapa atual da tarefa", () => {
  it("GET /tasks mostra a etapa em que cada tarefa está: assumir, depois SPEC", async () => {
    const model = new FakeModel();
    const modelHeld = hold();
    model.respond = async () => {
      await modelHeld.promise;
      return deliverSpec(DEFAULT_SPEC);
    };
    factory = await startTestFactory({ cards: [card("PROJ-1")], model });
    const commentHeld = hold();
    const addComment = factory.source.addComment.bind(factory.source);
    factory.source.addComment = async (key, body) => {
      await commentHeld.promise;
      return addComment(key, body);
    };

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "ativa");
    expect((await tasks(factory))[0]).toMatchObject({ key: "PROJ-1", stage: "assumir" });

    commentHeld.release();
    await eventually(() => expect(model.calls).toHaveLength(1));
    expect((await tasks(factory))[0]).toMatchObject({ key: "PROJ-1", status: "ativa", stage: "spec" });

    modelHeld.release();
    await waitForStatus(factory, "PROJ-1", "concluida");
  });

  it("uma tarefa que ainda não começou não tem etapa", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1")] });
    await fetch(`${factory.url}/daemon/pause`, { method: "POST" });

    await poll(factory);

    expect((await tasks(factory))[0]).toMatchObject({ key: "PROJ-1", status: "enfileirada", stage: null });
  });
});

describe("detalhe da tarefa", () => {
  it("GET /tasks/{projeto}/{card} traz o estado, o histórico de eventos e as escritas registradas no dry-run", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1"), card("PROJ-2")], dryRun: true });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    await waitForStatus(factory, "PROJ-2", "concluida");
    const detail = await api<Record<string, unknown>>(factory, "GET", "/tasks/exemplo/PROJ-1");

    expect(detail).toMatchObject({
      id: "exemplo/PROJ-1",
      project: "exemplo",
      key: "PROJ-1",
      title: "card PROJ-1",
      status: "concluida",
      // Sem repositório mapeado, a etapa de implementação termina sem fazer nada.
      stage: "implementacao",
      attempts: 0,
      reason: null,
      questions: [],
    });
    expect(detail.spec).toBe(DEFAULT_SPEC.spec);
    const history = detail.events as Record<string, unknown>[];
    expect(history.filter((e) => e.type === "task").map((e) => e.status)).toEqual([
      "enfileirada",
      "ativa",
      "concluida",
    ]);
    expect(history.every((e) => e.type !== "task" || e.id === "exemplo/PROJ-1")).toBe(true);
    expect(history.some((e) => e.target === "PROJ-2")).toBe(false);
    const writes = detail.writes as Record<string, unknown>[];
    expect(writes.map((w) => [w.action, w.dryRun])).toEqual([
      ["comment", true],
      ["transition", true],
      ["comment", true],
      ["comment", true],
    ]);
    expect(writes.every((w) => w.target === "PROJ-1")).toBe(true);
  });

  it("as escritas incluem as bloqueadas pelo guardrail, com o motivo, e o detalhe mostra por que a tarefa parou", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1")] });
    const original = factory.source.getCard.bind(factory.source);
    // O card passou para outra pessoa: o guardrail barra o comentário de assunção.
    factory.source.getCard = async (key) => {
      const found = await original(key);
      return found && { ...found, assignee: "maria" };
    };

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "bloqueada");
    const detail = await api<Record<string, unknown>>(factory, "GET", "/tasks/exemplo/PROJ-1");

    expect(detail).toMatchObject({ status: "bloqueada", reason: expect.stringMatching(/maria/) });
    expect(detail.writes).toMatchObject([
      { type: "blocked", target: "PROJ-1", action: "comment", reason: expect.stringMatching(/maria/) },
    ]);
  });

  it("mostra a pergunta pendente ao PO de uma tarefa que aguarda resposta", async () => {
    factory = await startTestFactory({ cards: [{ ...card("PROJ-1"), description: undefined }] });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    const detail = await api<Record<string, unknown>>(factory, "GET", "/tasks/exemplo/PROJ-1");

    expect(detail).toMatchObject({ stage: "spec", questions: [{ n: 1, to: PO, answer: null }] });
    expect((detail.questions as { text: string }[])[0]?.text).toMatch(/\S/);
  });

  it("um card que já estava em andamento mostra a etapa de veto e o fim do prazo", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1", "Em Andamento")] });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-veto");
    const detail = await api<Record<string, unknown>>(factory, "GET", "/tasks/exemplo/PROJ-1");
    const notify = (detail.events as Record<string, unknown>[]).find((e) => e.reason === "aguardando-veto");

    expect(detail).toMatchObject({ status: "aguardando-veto", stage: "veto" });
    expect(detail.vetoUntil).toBe(notify?.until);
  });

  it("responde 404 para uma tarefa que não existe", async () => {
    factory = await startTestFactory();

    const res = await fetch(`${factory.url}/tasks/exemplo/NADA-1`);

    expect(res.status).toBe(404);
  });
});

/** Requisição crua, para controlar Host e o caminho exato (o fetch normaliza `..`). */
function rawGet(
  f: TestFactory,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  const { port, host } = new URL(f.url);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: "GET", path, headers: { host, ...headers } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("página web de gestão", () => {
  it("GET / serve a página com CSP restritiva e nosniff", async () => {
    factory = await startTestFactory();

    const res = await fetch(`${factory.url}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(await res.text()).toMatch(/<script type="module" src="\/web\/app\.js"><\/script>/);
  });

  it("serve os assets sob /web/ com o tipo certo e os mesmos cabeçalhos", async () => {
    factory = await startTestFactory();

    const js = await fetch(`${factory.url}/web/app.js`);
    const css = await fetch(`${factory.url}/web/style.css`);

    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(js.headers.get("x-content-type-options")).toBe("nosniff");
    expect(js.headers.get("content-security-policy")).toMatch(/default-src 'self'/);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
  });

  it("não serve nada fora do diretório da página", async () => {
    factory = await startTestFactory();

    expect((await rawGet(factory, "/web/inexistente.js")).status).toBe(404);
    expect((await rawGet(factory, "/web/../package.json")).status).toBe(404);
    expect((await rawGet(factory, "/web/..%2Fpackage.json")).status).toBe(404);
    expect((await rawGet(factory, "/web/%2E%2E/src/factory.ts")).status).toBe(404);
    expect((await rawGet(factory, "/web/")).status).toBe(404);
  });

  it("só atende clientes locais, como a API", async () => {
    factory = await startTestFactory();
    const { port } = new URL(factory.url);

    expect(new URL(factory.url).hostname).toBe("127.0.0.1");
    expect((await rawGet(factory, "/", { host: `evil.example:${port}` })).status).toBe(403);
    expect((await rawGet(factory, "/web/app.js", { host: `evil.example:${port}` })).status).toBe(403);
    expect((await rawGet(factory, "/", { host: `localhost:${port}` })).status).toBe(200);
  });
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const webScripts = () =>
  readdirSync(WEB)
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({ file: f, source: readFileSync(join(WEB, f), "utf8") }));

/** Rotas (`MÉTODO /caminho`, com `{}` no lugar de cada parâmetro) que o JS da página chama. */
function routesUsedByPage(): Set<string> {
  const routes = new Set<string>();
  for (const { source } of webScripts()) {
    for (const m of source.matchAll(/\bapi\(\s*"(GET|POST)",\s*(["`])([^"`]+)\2/g))
      routes.add(`${m[1]} ${(m[3] as string).replace(/\$\{[^}]+\}/g, "{}")}`);
    for (const m of source.matchAll(/new EventSource\(\s*"([^"]+)"/g)) routes.add(`GET ${m[1]}`);
  }
  return routes;
}

describe("a página consome só a API", () => {
  it("toda rota que o JS da página chama está no /openapi.json, com o mesmo método", async () => {
    factory = await startTestFactory();
    const schema = await api<{ paths: Record<string, Record<string, unknown>> }>(factory, "GET", "/openapi.json");
    const documented = new Set(
      Object.entries(schema.paths).flatMap(([path, ops]) =>
        Object.keys(ops).map((method) => `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, "{}")}`),
      ),
    );

    const used = [...routesUsedByPage()];

    expect(used.filter((r) => !documented.has(r))).toEqual([]);
    // As rotas dos critérios: fila, tarefas, detalhe, stream e os comandos vetar, pausar, retomar, cancelar e reordenar.
    expect(used).toEqual(
      expect.arrayContaining([
        "GET /tasks",
        "GET /queue",
        "GET /tasks/{}/{}",
        "GET /events/stream",
        "POST /tasks/{}/{}/veto",
        "POST /tasks/{}/{}/pause",
        "POST /tasks/{}/{}/resume",
        "POST /tasks/{}/{}/cancel",
        "POST /tasks/order",
      ]),
    );
  });

  it("só o cliente da API faz requisições: nenhum outro fetch, XHR ou EventSource", () => {
    const network = webScripts().filter(({ source }) => /\bfetch\(|XMLHttpRequest|new EventSource\(/.test(source));

    expect(network.map((s) => s.file)).toEqual(["api.js"]);
  });

  it("nunca monta HTML a partir de dados: sem innerHTML, eval nem script ou estilo inline", () => {
    for (const { file, source } of webScripts())
      expect(source, file).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
    const html = readFileSync(join(WEB, "index.html"), "utf8");

    expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script type="module" src="/web/app.js">']);
    expect(html).not.toMatch(/\sstyle=|\son[a-z]+=|<style/i);
  });

  it("o diretório da página fica ao lado de src/ e de dist/, onde o daemon compilado o procura", () => {
    const build = JSON.parse(readFileSync(join(ROOT, "tsconfig.build.json"), "utf8")) as {
      compilerOptions: { rootDir: string; outDir: string };
    };
    const webFrom = (dir: string) => resolve(ROOT, dir, "..", "web");

    expect(webFrom(build.compilerOptions.rootDir)).toBe(WEB);
    expect(webFrom(build.compilerOptions.outDir)).toBe(WEB);
  });
});
