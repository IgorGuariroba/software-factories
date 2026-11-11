import { describe, expect, it } from "vitest";
import { API_SCHEMA } from "../src/api-schema.js";
import { createApiLocal, ehClienteLocal, ehJson, type Pedido, type Rota } from "../src/packages/api-local/index.js";

const hosts = new Set(["localhost:7420", "127.0.0.1:7420"]);

describe("guardas da API local", () => {
  it("aceita Host local e recusa qualquer outro (DNS rebinding)", () => {
    expect(ehClienteLocal({ metodo: "GET", host: "127.0.0.1:7420" }, hosts)).toBe(true);
    expect(ehClienteLocal({ metodo: "GET", host: "evil.example:7420" }, hosts)).toBe(false);
    expect(ehClienteLocal({ metodo: "GET", host: undefined }, hosts)).toBe(false);
  });

  it("um POST com Origin de outro site é recusado (CSRF), mas o mesmo site local passa", () => {
    expect(ehClienteLocal({ metodo: "POST", host: "localhost:7420", origem: "https://atacante.example" }, hosts)).toBe(
      false,
    );
    expect(ehClienteLocal({ metodo: "POST", host: "localhost:7420", origem: "http://localhost:7420" }, hosts)).toBe(
      true,
    );
  });

  it("reconhece Content-Type JSON com parâmetros e sem diferença de caixa", () => {
    expect(ehJson("application/json; charset=utf-8")).toBe(true);
    expect(ehJson("Application/JSON")).toBe(true);
    expect(ehJson("text/plain")).toBe(false);
    expect(ehJson(undefined)).toBe(false);
  });
});

const pedido = (metodo: string, caminho: string): Pedido => ({
  metodo,
  caminho,
  host: "localhost:7420",
  corpo: async () => undefined,
});

describe("despacho de rotas", () => {
  const rotas: Rota[] = [
    {
      metodo: "GET",
      caminho: "/queue",
      documentada: "/queue",
      manipular: async () => ({ status: 200, body: "fila" }),
    },
    {
      metodo: "POST",
      caminho: /^\/tasks\/([^/]+)\/([^/]+)\/veto$/,
      documentada: "/tasks/{project}/{key}/veto",
      manipular: async (_p, captura) => ({ status: 200, body: captura }),
    },
  ];
  const api = createApiLocal({ rotas, hosts: () => hosts });

  it("responde a rota literal pelo método e pelo caminho", async () => {
    expect(await api.tratar(pedido("GET", "/queue"))).toEqual({ status: 200, body: "fila" });
  });

  it("entrega as capturas de uma rota com parâmetros", async () => {
    expect(await api.tratar(pedido("POST", "/tasks/exemplo/PROJ-1/veto"))).toEqual({
      status: 200,
      body: ["exemplo", "PROJ-1"],
    });
  });

  it("devolve undefined quando nenhuma rota casa, para o chamador decidir (404 ou arquivo)", async () => {
    expect(await api.tratar(pedido("GET", "/nada"))).toBeUndefined();
    expect(await api.tratar(pedido("POST", "/queue"))).toBeUndefined();
  });

  it("recusa com 403 um cliente que não é local, antes de olhar a rota", async () => {
    const resposta = await api.tratar({ ...pedido("GET", "/queue"), host: "evil.example:7420" });
    expect(resposta).toEqual({ status: 403, body: { error: "a API aceita só clientes locais" } });
  });
});

describe("documentação: toda rota do adaptador está no OpenAPI", () => {
  it("cada rota declara um caminho documentado no schema, com o mesmo método", async () => {
    const { rotasDocumentadas } = await import("../src/packages/api-local/index.js");
    const paths = API_SCHEMA.paths as Record<string, Record<string, unknown>>;
    for (const rota of rotasDocumentadas()) {
      expect(paths[rota.documentada], `${rota.metodo} ${rota.documentada}`).toBeDefined();
      expect(paths[rota.documentada]?.[rota.metodo.toLowerCase()], `${rota.metodo} ${rota.documentada}`).toBeDefined();
    }
  });
});
