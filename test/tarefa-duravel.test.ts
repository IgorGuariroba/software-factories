import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  api,
  assumeComments,
  events,
  eventually,
  hold,
  poll,
  startTestFactory,
  statusOf,
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

const card = (key: string) => ({ key, title: `card ${key}`, status: "A Fazer", assignee: USER });

/** Segura `addComment` do card `key` até o teste soltar. */
function holdComment(f: TestFactory, key: string) {
  const h = hold();
  const addComment = f.source.addComment.bind(f.source);
  f.source.addComment = async (k, body) => {
    if (k === key) await h.promise;
    return addComment(k, body);
  };
  return h;
}

describe("fila única", () => {
  it("só uma tarefa fica ativa por vez; as outras esperam na fila", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1"), card("PROJ-2")] });
    const held = holdComment(factory, "PROJ-1");

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "ativa");

    expect(await statusOf(factory, "PROJ-2")).toBe("enfileirada");
    expect(assumeComments(factory.source, "PROJ-2")).toEqual([]);

    held.release();
    await waitForStatus(factory, "PROJ-2", "concluida");
    expect(await statusOf(factory, "PROJ-1")).toBe("concluida");
  });

  it("GET /tasks lista as tarefas na ordem da fila", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1"), card("PROJ-2")] });
    await api(factory, "POST", "/daemon/pause");

    await poll(factory);

    expect(await tasks(factory)).toMatchObject([
      { id: "exemplo/PROJ-1", project: "exemplo", key: "PROJ-1", title: "card PROJ-1", status: "enfileirada" },
      { id: "exemplo/PROJ-2", project: "exemplo", key: "PROJ-2", title: "card PROJ-2", status: "enfileirada" },
    ]);
  });
});

describe("reinício do daemon", () => {
  it("retoma a tarefa de onde parou, sem duplicar o comentário, e mantém o histórico de eventos", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1")] });
    const source = factory.source;
    const transition = source.transition.bind(source);
    let stuck = true;
    // A primeira transição nunca termina: o daemon "cai" no meio dela.
    source.transition = async (key, status) => (stuck ? new Promise<void>(() => {}) : transition(key, status));

    await poll(factory);
    await eventually(() => expect(assumeComments(source, "PROJ-1")).toHaveLength(1));
    stuck = false;
    factory = await factory.restart();

    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(assumeComments(source, "PROJ-1")).toHaveLength(1);
    expect(source.cards[0]?.status).toBe("Em Andamento");
    // O histórico sobrevive ao reinício. A transição aparece de novo porque a primeira nunca chegou ao Jira;
    // o comentário, que chegou, não é repetido.
    const writes = (await events(factory)).filter((e) => e.type === "write").map((e) => e.action);
    expect(
      (await events(factory)).filter((e) => e.type === "write" && String(e.content).startsWith("Assumindo este card.")),
    ).toHaveLength(1);
    expect(writes).toContain("transition");
  });

  it("no dry-run, um reinício no meio da tarefa não registra de novo as escritas já registradas", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1")], dryRun: true });
    const first = factory;
    const source = factory.source;
    const listComments = source.listComments.bind(source);
    const specWritten = async () =>
      (await events(first)).some((e) => e.type === "write" && String(e.content).startsWith("SPEC"));
    let stuck = true;
    let reached = false;
    // Depois de registrar a SPEC, a leitura para registrar os Tickets nunca termina: o daemon cai no meio do passo.
    source.listComments = async (key) => {
      if (stuck && (await specWritten())) {
        reached = true;
        return new Promise(() => {});
      }
      return listComments(key);
    };

    await poll(factory);
    await eventually(() => expect(reached).toBe(true));
    stuck = false;
    factory = await factory.restart();
    await waitForStatus(factory, "PROJ-1", "concluida");

    const writes = (await events(factory))
      .filter((e) => e.type === "write" && String(e.target).startsWith("PROJ-1"))
      .map((e) => `${e.action} ${e.target}: ${e.content}`);
    expect(writes.filter((w) => w.includes(": SPEC"))).toHaveLength(1);
    expect(writes.filter((w) => w.includes(": Tickets"))).toHaveLength(1);
    expect(writes.filter((w) => w.includes(": Assumindo este card."))).toHaveLength(1);
    expect(new Set(writes).size).toBe(writes.length);
    expect(source.commentsOf("PROJ-1")).toEqual([]);
  });

  it("um reinício com o daemon pausado continua pausado", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1")] });
    await api(factory, "POST", "/daemon/pause");
    await poll(factory);

    factory = await factory.restart();

    expect(await api(factory, "GET", "/daemon")).toEqual({ paused: true });
    expect(await statusOf(factory, "PROJ-1")).toBe("enfileirada");
  });
});

describe("controle das tarefas", () => {
  it("pausar a tarefa ativa a para no próximo passo e libera a fila; retomar a conclui", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1"), card("PROJ-2")] });
    const held = holdComment(factory, "PROJ-1");
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "ativa");

    await api(factory, "POST", "/tasks/exemplo/PROJ-1/pause");
    held.release();

    await waitForStatus(factory, "PROJ-1", "pausada");
    await waitForStatus(factory, "PROJ-2", "concluida");
    expect(factory.source.cards[0]?.status).toBe("A Fazer"); // parou antes da transição

    await api(factory, "POST", "/tasks/exemplo/PROJ-1/resume");
    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(assumeComments(factory.source, "PROJ-1")).toHaveLength(1);
    expect(factory.source.cards[0]?.status).toBe("Em Andamento");
  });

  it("pausar uma tarefa enfileirada faz a fila pular ela até ser retomada", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1"), card("PROJ-2")] });
    await api(factory, "POST", "/daemon/pause");
    await poll(factory);

    await api(factory, "POST", "/tasks/exemplo/PROJ-1/pause");
    await api(factory, "POST", "/daemon/resume");

    await waitForStatus(factory, "PROJ-2", "concluida");
    expect(await statusOf(factory, "PROJ-1")).toBe("pausada");
    expect(assumeComments(factory.source, "PROJ-1")).toEqual([]);

    await api(factory, "POST", "/tasks/exemplo/PROJ-1/resume");
    await waitForStatus(factory, "PROJ-1", "concluida");
  });

  it("cancelar a tarefa ativa a encerra e a fila segue", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1"), card("PROJ-2")] });
    const held = holdComment(factory, "PROJ-1");
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "ativa");

    await api(factory, "POST", "/tasks/exemplo/PROJ-1/cancel");

    await waitForStatus(factory, "PROJ-1", "cancelada");
    await waitForStatus(factory, "PROJ-2", "concluida");
    held.release();
    expect(factory.source.cards[0]?.status).toBe("A Fazer");
  });

  it("pausar o daemon impede que novas tarefas comecem; retomar as executa", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1")] });

    await api(factory, "POST", "/daemon/pause");
    await poll(factory);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await statusOf(factory, "PROJ-1")).toBe("enfileirada");
    expect(assumeComments(factory.source, "PROJ-1")).toEqual([]);

    await api(factory, "POST", "/daemon/resume");
    await waitForStatus(factory, "PROJ-1", "concluida");
  });

  it("reordenar a fila muda qual tarefa começa primeiro", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1"), card("PROJ-2"), card("PROJ-3")] });
    await api(factory, "POST", "/daemon/pause");
    await poll(factory);

    await api(factory, "POST", "/tasks/order", { ids: ["exemplo/PROJ-3", "exemplo/PROJ-1"] });
    expect((await tasks(factory)).map((t) => t.key)).toEqual(["PROJ-3", "PROJ-1", "PROJ-2"]);

    await api(factory, "POST", "/daemon/resume");
    await waitForStatus(factory, "PROJ-2", "concluida");
    const commented = (await events(factory))
      .filter((e) => e.action === "comment" && String(e.content).startsWith("Assumindo este card."))
      .map((e) => e.target);
    expect(commented).toEqual(["PROJ-3", "PROJ-1", "PROJ-2"]);
  });

  it("ids repetidos na reordenação não duplicam tarefas na fila", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1"), card("PROJ-2")] });
    await api(factory, "POST", "/daemon/pause");
    await poll(factory);

    await api(factory, "POST", "/tasks/order", { ids: ["exemplo/PROJ-2", "exemplo/PROJ-2", "exemplo/PROJ-1"] });

    expect((await tasks(factory)).map((t) => t.key)).toEqual(["PROJ-2", "PROJ-1"]);
  });

  it("responde 404 para tarefa inexistente", async () => {
    factory = await startTestFactory();

    const res = await fetch(`${factory.url}/tasks/exemplo/NADA-1/pause`, { method: "POST" });

    expect(res.status).toBe(404);
  });
});

describe("stream de eventos", () => {
  it("GET /events/stream envia as mudanças de estado da tarefa por SSE", async () => {
    factory = await startTestFactory({ cards: [card("PROJ-1")] });
    const res = await fetch(`${factory.url}/events/stream`);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const received: Record<string, unknown>[] = [];
    const reading = (async () => {
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += new TextDecoder().decode(value);
        for (let i = buffer.indexOf("\n\n"); i >= 0; i = buffer.indexOf("\n\n")) {
          const data = buffer.slice(0, i).replace(/^data: /, "");
          buffer = buffer.slice(i + 2);
          if (data.startsWith("{")) received.push(JSON.parse(data));
        }
      }
    })();

    await poll(factory);
    await eventually(() =>
      expect(received).toContainEqual(
        expect.objectContaining({ type: "task", id: "exemplo/PROJ-1", status: "concluida" }),
      ),
    );
    expect(received).toContainEqual(expect.objectContaining({ type: "task", id: "exemplo/PROJ-1", status: "ativa" }));

    await reader.cancel();
    await reading.catch(() => undefined);
  });
});

/** Requisição crua, para controlar Host e Origin (que o fetch não deixa definir livremente). */
function rawRequest(
  f: TestFactory,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<number> {
  const { port } = new URL(f.url);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end(body);
  });
}

describe("API só para clientes locais", () => {
  it("recusa Host que não seja localhost/127.0.0.1 na porta do servidor (DNS rebinding)", async () => {
    factory = await startTestFactory();
    const { port } = new URL(factory.url);

    expect(await rawRequest(factory, "GET", "/tasks", { host: `evil.example:${port}` })).toBe(403);
    expect(await rawRequest(factory, "GET", "/tasks", { host: "localhost:1" })).toBe(403);
    expect(await rawRequest(factory, "GET", "/tasks", { host: `localhost:${port}` })).toBe(200);
    expect(await rawRequest(factory, "GET", "/tasks", { host: `127.0.0.1:${port}` })).toBe(200);
  });

  it("recusa POST com Origin de outro site (CSRF), aceita sem Origin ou com origem local", async () => {
    factory = await startTestFactory();
    const host = new URL(factory.url).host;

    expect(await rawRequest(factory, "POST", "/daemon/pause", { host, origin: "https://evil.example" })).toBe(403);
    expect(await rawRequest(factory, "POST", "/daemon/pause", { host, origin: `http://${host}` })).toBe(200);
    expect(await rawRequest(factory, "POST", "/daemon/pause", { host })).toBe(200);
  });

  it("POST /tasks/order exige Content-Type application/json", async () => {
    factory = await startTestFactory();
    const host = new URL(factory.url).host;
    const body = JSON.stringify({ ids: [] });

    expect(await rawRequest(factory, "POST", "/tasks/order", { host, "content-type": "text/plain" }, body)).toBe(415);
    expect(
      await rawRequest(
        factory,
        "POST",
        "/tasks/order",
        { host, "content-type": "application/json; charset=utf-8" },
        body,
      ),
    ).toBe(200);
  });
});

describe("schema da API", () => {
  it("POST /tasks/order declara corpo e ids obrigatórios e a resposta 400", async () => {
    factory = await startTestFactory();

    const schema = await api<{ paths: Record<string, { post: unknown }> }>(factory, "GET", "/openapi.json");

    expect(schema.paths["/tasks/order"]?.post).toMatchObject({
      requestBody: { required: true, content: { "application/json": { schema: { required: ["ids"] } } } },
      responses: { "400": expect.anything() },
    });
  });

  it("GET /openapi.json descreve todas as rotas", async () => {
    factory = await startTestFactory();

    const schema = await api<{ openapi: string; paths: Record<string, object> }>(factory, "GET", "/openapi.json");

    expect(schema.openapi).toMatch(/^3\./);
    expect(Object.keys(schema.paths).sort()).toEqual(
      [
        "/daemon",
        "/daemon/pause",
        "/daemon/resume",
        "/events",
        "/events/stream",
        "/ferramentas",
        "/github-app",
        "/github/importar",
        "/github/repos",
        "/integracoes/canais",
        "/integracoes/fontes",
        "/openapi.json",
        "/perfis/modelos",
        "/poll",
        "/projetos",
        "/projetos/github",
        "/projetos/gitlab",
        "/projetos/pessoas-da-fonte",
        "/projetos/{nome}/configuracao",
        "/projetos/{nome}/confirmacao",
        "/projetos/{nome}/estado",
        "/projetos/{nome}/historico",
        "/projetos/{nome}/pausa",
        "/projetos/{nome}/pendencias",
        "/projetos/{nome}/remocao",
        "/projetos/{nome}/retomada",
        "/queue",
        "/repos",
        "/repos/desplugar",
        "/repos/plugar",
        "/segredos",
        "/segredos/{nome}",
        "/settings/retro",
        "/tasks",
        "/tasks/order",
        "/tasks/{project}/{key}",
        "/tasks/{project}/{key}/cancel",
        "/tasks/{project}/{key}/etapas/{etapa}/memoria/esquecer",
        "/tasks/{project}/{key}/etapas/{etapa}/mensagem",
        "/tasks/{project}/{key}/pause",
        "/tasks/{project}/{key}/questions/{n}",
        "/tasks/{project}/{key}/questions/{n}/answer",
        "/tasks/{project}/{key}/questions/{n}/approve",
        "/tasks/{project}/{key}/questions/{n}/reminder",
        "/tasks/{project}/{key}/questions/{n}/reminder/approve",
        "/tasks/{project}/{key}/repair",
        "/tasks/{project}/{key}/resume",
        "/tasks/{project}/{key}/retros/{stage}/{n}",
        "/tasks/{project}/{key}/retros/{stage}/{n}/approve",
        "/tasks/{project}/{key}/spec",
        "/tasks/{project}/{key}/spec/approve",
        "/tasks/{project}/{key}/trace",
        "/tasks/{project}/{key}/triage",
        "/tasks/{project}/{key}/triage/decide",
        "/tasks/{project}/{key}/veto",
        "/telegram/configuracao",
      ].sort(),
    );
  });
});
