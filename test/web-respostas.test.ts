import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_SCHEMA } from "../src/api-schema.js";
import { DEFAULT_SPEC, deliverSpec, FakeModel } from "./fakes/fake-model.js";
import { PageDocument, PageElement } from "./fakes/page-dom.js";
import { api, events, eventually, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

const fetchReal = globalThis.fetch;
const BASE = "/tasks/exemplo/PROJ-1";
let factory: TestFactory | undefined;

beforeEach(() => vi.resetModules());
afterEach(async () => {
  vi.unstubAllGlobals();
  await factory?.close();
  factory = undefined;
});

function instalarPagina(buscar: typeof fetch): PageDocument {
  const document = new PageDocument();
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", { hash: "#/tarefa/exemplo/PROJ-1", replace: vi.fn() });
  vi.stubGlobal("window", { addEventListener: vi.fn(), confirm: vi.fn(() => true) });
  vi.stubGlobal(
    "EventSource",
    class {
      addEventListener = vi.fn();
    },
  );
  vi.stubGlobal("fetch", buscar);
  return document;
}

function itens(document: PageDocument): PageElement[] {
  return document
    .getElementById("detalhe-perguntas")
    .children.filter((child): child is PageElement => child instanceof PageElement && child.tagName === "LI");
}

function controles(item: PageElement) {
  const campo = item.all().find((element) => ["INPUT", "TEXTAREA"].includes(element.tagName));
  const botao = item
    .all()
    .find((element) => element.tagName === "BUTTON" && /responder|enviar/i.test(element.textContent));
  expect(campo, "pergunta pendente precisa ter um campo de resposta").toBeDefined();
  expect(botao, "pergunta pendente precisa ter um botão de envio").toBeDefined();
  if (!campo || !botao) throw new Error("Controles de resposta não renderizados");
  return { campo, botao };
}

interface SchemaNode {
  type?: string | string[];
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  allOf?: SchemaNode[];
  $ref?: string;
}
interface Operation {
  parameters?: unknown[];
  requestBody?: { required?: boolean; content?: Record<string, { schema: SchemaNode }> };
  responses?: Record<string, unknown>;
}
const schema = API_SCHEMA as unknown as {
  paths: Record<string, { post?: Operation }>;
  components: { schemas: Record<string, SchemaNode> };
};

describe("respostas a perguntas no detalhe web", () => {
  it("a rota de resposta está entre as rotas usadas pelo cliente da página", () => {
    const web = fileURLToPath(new URL("../web/", import.meta.url));
    const usadas = new Set<string>();
    for (const nome of readdirSync(web).filter((arquivo) => arquivo.endsWith(".js"))) {
      const codigo = readFileSync(join(web, nome), "utf8");
      for (const match of codigo.matchAll(/\bapi\(\s*"(GET|POST)",\s*(["`])([^"`]+)\2/g)) {
        usadas.add(`${match[1]} ${match[3].replace(/\$\{[^}]+\}/g, "{}")}`);
      }
    }
    expect(usadas).toContain("POST /tasks/{}/{}/questions/{}/answer");
  });

  it("documenta POST answer, os três parâmetros e o corpo JSON da resposta", () => {
    const operation = schema.paths["/tasks/{project}/{key}/questions/{n}/answer"]?.post;
    expect(operation).toBeDefined();
    if (!operation) throw new Error("POST answer ausente do OpenAPI");
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "project", in: "path", required: true }),
        expect.objectContaining({ name: "key", in: "path", required: true }),
        expect.objectContaining({ name: "n", in: "path", required: true }),
      ]),
    );
    expect(operation.requestBody?.required).toBe(true);
    const body = operation.requestBody?.content?.["application/json"].schema;
    expect(body?.required).toContain("answer");
    expect(body?.properties?.answer.type).toBe("string");
    expect(operation.responses).toEqual(
      expect.objectContaining({
        "200": expect.any(Object),
        "400": expect.any(Object),
        "404": expect.any(Object),
        "409": expect.any(Object),
        "415": expect.any(Object),
      }),
    );
  });

  it("documenta origin, userResponse e needsForwarding das perguntas no detalhe", () => {
    const detalhe = schema.components.schemas.TaskDetail;
    const propriedades = detalhe.allOf?.find((parte) => parte.properties?.questions)?.properties;
    let pergunta = propriedades?.questions.items;
    if (pergunta?.$ref) pergunta = schema.components.schemas[pergunta.$ref.split("/").at(-1) ?? ""];
    expect(pergunta?.properties?.origin.enum).toEqual(expect.arrayContaining(["grill", "card-raso", "tecnica"]));
    expect(pergunta?.properties?.userResponse.type).toEqual(["string", "null"]);
    expect(pergunta?.properties?.needsForwarding.type).toBe("boolean");
  });

  it("renderiza campo e botão em cada pergunta pendente, mas não nas respondidas", async () => {
    const detalhe = {
      id: "exemplo/PROJ-1",
      project: "exemplo",
      key: "PROJ-1",
      title: "Conexão com banco",
      status: "aguardando-humano",
      stage: "spec",
      attempts: 0,
      questions: [
        { n: 1, to: USER, text: "Qual versão do banco?", origin: "tecnica", answer: null, publication: "sent" },
        { n: 2, to: "po", text: "Qual a regra?", origin: "grill", answer: null, publication: "sent" },
        { n: 3, to: USER, text: "Qual protocolo?", origin: "tecnica", answer: "HTTPS", publication: "sent" },
      ],
      spec: null,
      implementation: null,
      tickets: [],
      retros: [],
      events: [],
      writes: [],
    };
    const document = instalarPagina(
      vi.fn<typeof fetch>(async (input) => {
        const path = String(input);
        const resposta = path === "/tasks" ? [detalhe] : path === "/daemon" ? { paused: false } : detalhe;
        return new Response(JSON.stringify(resposta), { status: 200 });
      }),
    );

    await import("../web/app.js");

    await eventually(() => expect(itens(document)).toHaveLength(3));
    controles(itens(document)[0]);
    controles(itens(document)[1]);
    expect(
      itens(document)[2]
        .all()
        .filter((element) => ["INPUT", "TEXTAREA"].includes(element.tagName)),
    ).toEqual([]);
  });

  it("o botão usa a API real: não sei encaminha; resposta resolutiva acorda a Tarefa", async () => {
    const model = new FakeModel();
    let perguntou = false;
    model.respond = () => {
      if (perguntou) return deliverSpec(DEFAULT_SPEC);
      perguntou = true;
      return fauxAssistantMessage([fauxToolCall("perguntar_tecnico", { pergunta: "Qual versão do PostgreSQL?" })], {
        stopReason: "toolUse",
      });
    };
    factory = await startTestFactory({
      cards: [{ key: "PROJ-1", title: "Conexão com banco", status: "A Fazer", assignee: USER }],
      model,
      config: { people: [{ id: USER, role: "po" }] },
    });
    const f = factory;
    await poll(f);
    await waitForStatus(f, "PROJ-1", "aguardando-humano");
    const posts: { path: string; body: unknown; headers: unknown }[] = [];
    const document = instalarPagina(
      vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(String(input), f.url);
        if (init?.method === "POST") posts.push({ path: url.pathname, body: init.body, headers: init.headers });
        return fetchReal(url, init);
      }),
    );
    await import("../web/app.js");
    await eventually(() => expect(itens(document)).toHaveLength(1));

    async function enviarPelaPagina(texto: string) {
      const { campo, botao } = controles(itens(document)[0]);
      campo.value = texto;
      const antes = posts.length;
      await botao.fire("click");
      // Um formulário nativo pode usar submit em vez de um handler no botão.
      if (posts.length === antes) {
        let form = botao.parentElement;
        while (form && form.tagName !== "FORM") form = form.parentElement;
        await form?.fire("submit");
      }
      await eventually(() => expect(posts).toHaveLength(antes + 1));
      expect(posts[antes]).toMatchObject({
        path: `${BASE}/questions/1/answer`,
        body: JSON.stringify({ answer: texto }),
        headers: expect.objectContaining({ "content-type": "application/json" }),
      });
    }

    await enviarPelaPagina("não sei");

    await eventually(async () =>
      expect(await events(f)).toContainEqual(
        expect.objectContaining({
          type: "question",
          target: "PROJ-1",
          n: 1,
          status: "encaminhar",
          text: "não sei",
        }),
      ),
    );
    const pendente = await api<{ questions: Record<string, unknown>[] }>(f, "GET", BASE);
    expect(pendente.questions[0]).toMatchObject({
      origin: "tecnica",
      answer: null,
      userResponse: "não sei",
      needsForwarding: true,
    });
    // Aguarda o refresh real da página antes de usar os novos controles.
    await eventually(() => expect(controles(itens(document)[0]).botao.disabled).toBe(false));

    await enviarPelaPagina("PostgreSQL 16 com TLS obrigatório.");

    await waitForStatus(f, "PROJ-1", "concluida");
    const resolvida = await api<{ questions: Record<string, unknown>[] }>(f, "GET", BASE);
    expect(resolvida.questions[0].answer).toBe("PostgreSQL 16 com TLS obrigatório.");
    expect(model.calls.some((call) => call.input.includes("PostgreSQL 16 com TLS obrigatório."))).toBe(true);
  });
});
