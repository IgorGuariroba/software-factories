import { afterEach, describe, expect, it } from "vitest";
import { resolverAgenteDaEtapa, textoAdicionalDoAgente } from "../src/agente-etapa-config.js";
import { ProjectConfig } from "../src/config.js";
import { FakeModel } from "./fakes/fake-model.js";
import { poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

const base = {
  name: "Projeto",
  source: { type: "github", project: "PROJ", repo: "dono/repo", assignee: "dono" },
  roles: { spec: { provider: "claude", model: "claude-a" } },
  statuses: {},
  skills: [
    { nome: "estilo-curto", descricao: "Textos curtos", conteudo: "Escreva frases curtas." },
    { nome: "fatias-finas", descricao: "", conteudo: "Fatias de no máximo um dia." },
  ],
};

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

describe("skills do projeto", () => {
  it("aceita skills com nome válido", () => {
    expect(ProjectConfig.safeParse(base).success).toBe(true);
  });

  it("recusa um nome de skill fora do padrão", () => {
    const r = ProjectConfig.safeParse({ ...base, skills: [{ nome: "Estilo Curto!", conteudo: "x" }] });
    expect(r.success).toBe(false);
  });

  it("recusa uma etapa que pede uma skill que o projeto não tem", () => {
    const r = ProjectConfig.safeParse({ ...base, etapas: { spec: { skills: ["inexistente"] } } });
    expect(r.success).toBe(false);
  });
});

describe("skills por etapa", () => {
  it("sem skills escolhidas, a etapa não recebe nenhuma", () => {
    const config = ProjectConfig.parse(base);
    expect(resolverAgenteDaEtapa(config, "spec").skills).toEqual([]);
  });

  it("recebe só as skills escolhidas, na ordem da escolha", () => {
    const config = ProjectConfig.parse({ ...base, etapas: { spec: { skills: ["fatias-finas", "estilo-curto"] } } });
    expect(resolverAgenteDaEtapa(config, "spec").skills.map((s) => s.nome)).toEqual(["fatias-finas", "estilo-curto"]);
  });

  it("o texto adicional traz o conteúdo das skills ativas e não das desligadas", () => {
    const config = ProjectConfig.parse({ ...base, etapas: { spec: { skills: ["estilo-curto"] } } });
    const texto = textoAdicionalDoAgente(resolverAgenteDaEtapa(config, "spec"));
    expect(texto).toContain("Escreva frases curtas.");
    expect(texto).not.toContain("Fatias de no máximo um dia.");
  });

  it("sem skills nem prompt adicional, não há texto adicional", () => {
    const config = ProjectConfig.parse(base);
    expect(textoAdicionalDoAgente(resolverAgenteDaEtapa(config, "spec"))).toBeUndefined();
  });
});

describe("skills chegam ao prompt da etapa", () => {
  it("a SPEC recebe o conteúdo da skill ativa", async () => {
    const model = new FakeModel();
    const card = { key: "PROJ-1", title: "Exportar relatório", status: "A Fazer", assignee: USER };
    factory = await startTestFactory({
      cards: [card],
      model,
      config: {
        skills: [{ nome: "estilo-curto", conteudo: "Marcador de skill: frases curtas." }],
        etapas: { spec: { skills: ["estilo-curto"] } },
      },
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    const chamada = model.calls.find((c) => c.tools.includes("entregar_spec"));
    expect(chamada?.context).toContain("Marcador de skill: frases curtas.");
  });
});
