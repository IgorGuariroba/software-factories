import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectConfig } from "../src/config.js";
import { deliverSpec, FakeModel } from "./fakes/fake-model.js";
import { poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

const servidorFalso = fileURLToPath(new URL("./fakes/mcp-servidor-falso.mjs", import.meta.url));

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const card = { key: "PROJ-1", title: "Exportar relatório", status: "A Fazer", assignee: USER };
const servidores = [{ nome: "falso", comando: process.execPath, argumentos: [servidorFalso] }];

async function ferramentasDaSpec(config: Record<string, unknown>): Promise<string[]> {
  const model = new FakeModel();
  factory = await startTestFactory({ cards: [card], model, config });
  await poll(factory);
  await waitForStatus(factory, "PROJ-1", "concluida");
  return model.calls.find((c) => c.tools.includes("entregar_spec"))?.tools ?? [];
}

describe("MCP por etapa", () => {
  it("recusa uma etapa que usa um servidor MCP não cadastrado no projeto", () => {
    const r = ProjectConfig.safeParse({
      name: "P",
      source: { type: "github", project: "PROJ", repo: "dono/repo", assignee: "dono" },
      roles: { spec: { provider: "claude", model: "a" } },
      statuses: {},
      etapas: { spec: { mcp: [{ servidor: "inexistente", ferramentas: ["x"] }] } },
    });
    expect(r.success).toBe(false);
  });

  it("a etapa recebe só as tools MCP liberadas na configuração", async () => {
    const ferramentas = await ferramentasDaSpec({
      mcpServers: servidores,
      etapas: { spec: { mcp: [{ servidor: "falso", ferramentas: ["buscar_card"] }] } },
    });
    expect(ferramentas).toContain("mcp_exemplo_falso_buscar_card");
    expect(ferramentas).not.toContain("mcp_exemplo_falso_apagar_card");
  });

  it("o modelo chama a tool MCP liberada e recebe o resultado do servidor", async () => {
    const model = new FakeModel();
    model.respond = (call) =>
      call.toolResults.length === 0
        ? fauxAssistantMessage([fauxToolCall("mcp_exemplo_falso_buscar_card", { chave: "PROJ-1" })], {
            stopReason: "toolUse",
          })
        : deliverSpec({ spec: "Exportação em CSV.", tickets: [{ titulo: "Endpoint", aceite: "Responde 200" }] });
    factory = await startTestFactory({
      cards: [card],
      model,
      config: {
        mcpServers: servidores,
        etapas: { spec: { mcp: [{ servidor: "falso", ferramentas: ["buscar_card"] }] } },
      },
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const depois = model.calls.find((c) => c.toolResults.length > 0);
    expect(depois?.toolResults[0]).toMatchObject({ name: "mcp_exemplo_falso_buscar_card", isError: false });
    expect(depois?.toolResults[0]?.text).toContain("resultado de buscar_card");
  });

  it("sem MCP na etapa, nenhuma tool MCP é oferecida ao modelo", async () => {
    const ferramentas = await ferramentasDaSpec({ mcpServers: servidores });
    expect(ferramentas.some((t) => t.startsWith("mcp_"))).toBe(false);
  });

  it("um servidor com lista de tools vazia fica desligado para a etapa", async () => {
    const ferramentas = await ferramentasDaSpec({
      mcpServers: servidores,
      etapas: { spec: { mcp: [{ servidor: "falso", ferramentas: [] }] } },
    });
    expect(ferramentas.some((t) => t.startsWith("mcp_"))).toBe(false);
  });
});
