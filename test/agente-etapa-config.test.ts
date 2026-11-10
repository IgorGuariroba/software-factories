import { describe, expect, it } from "vitest";
import { resolverAgenteDaEtapa } from "../src/agente-etapa-config.js";
import { ProjectConfig } from "../src/config.js";
import { FERRAMENTAS_DA_ETAPA } from "../src/ferramentas-catalogo.js";
import { lerConfiguracao } from "../src/packages/config-store/index.js";

const base = {
  name: "Projeto",
  source: { type: "github", project: "PROJ", repo: "dono/repo", assignee: "dono" },
  roles: {
    spec: { provider: "claude", model: "claude-a" },
    implementer: { provider: "codex", model: "codex-b" },
    reviewer: { provider: "cursor", model: "cursor-c" },
  },
  statuses: {},
};

const configDe = (extra: Record<string, unknown> = {}) => ProjectConfig.parse({ ...base, ...extra });

describe("padrão embutido por etapa", () => {
  it("sem configuração gravada, cada etapa usa as ferramentas que tem hoje", () => {
    const config = configDe();
    for (const etapa of ["spec", "review", "implementacao", "retro"] as const) {
      expect(resolverAgenteDaEtapa(config, etapa).ferramentas).toEqual([...FERRAMENTAS_DA_ETAPA[etapa]]);
    }
  });

  it("sem configuração gravada, o modelo vem do papel que a etapa já usa", () => {
    const config = configDe();
    expect(resolverAgenteDaEtapa(config, "spec").modelo).toEqual(config.roles.spec);
    expect(resolverAgenteDaEtapa(config, "review").modelo).toEqual(config.roles.reviewer);
    expect(resolverAgenteDaEtapa(config, "implementacao").modelo).toEqual(config.roles.implementer);
  });

  it("sem configuração gravada, o prompt adicional é vazio e não há MCP", () => {
    const agente = resolverAgenteDaEtapa(configDe(), "spec");
    expect(agente.promptAdicional).toBe("");
    expect(agente.mcp).toEqual([]);
  });

  it("etapa sem modelo próprio cai no modelo de spec quando o papel não existe", () => {
    const config = configDe({ roles: { spec: base.roles.spec } });
    expect(resolverAgenteDaEtapa(config, "implementacao").modelo).toEqual(config.roles.spec);
    expect(resolverAgenteDaEtapa(config, "retro").modelo).toEqual(config.roles.spec);
  });
});

describe("configuração gravada por etapa", () => {
  it("uma etapa com subconjunto de ferramentas usa o subconjunto gravado", () => {
    const config = configDe({ etapas: { review: { ferramentas: ["ler_contexto_review"] } } });
    expect(resolverAgenteDaEtapa(config, "review").ferramentas).toEqual(["ler_contexto_review"]);
  });

  it("a configuração gravada de uma etapa não altera as outras", () => {
    const config = configDe({ etapas: { review: { ferramentas: [] } } });
    expect(resolverAgenteDaEtapa(config, "spec").ferramentas).toEqual([...FERRAMENTAS_DA_ETAPA.spec]);
  });

  it("um modelo gravado para a etapa vale no lugar do papel", () => {
    const outro = { provider: "claude", model: "claude-z" };
    const config = configDe({ etapas: { review: { modelo: outro } } });
    expect(resolverAgenteDaEtapa(config, "review").modelo).toEqual(outro);
  });

  it("o prompt adicional gravado é usado como está", () => {
    const config = configDe({ etapas: { spec: { promptAdicional: "Prefira fatias pequenas." } } });
    expect(resolverAgenteDaEtapa(config, "spec").promptAdicional).toBe("Prefira fatias pequenas.");
  });

  it("sobrevive à gravação e à leitura do estado durável como JSON", () => {
    const config = configDe({ etapas: { review: { ferramentas: ["ler_contexto_review"] } } });
    const guardada = JSON.stringify(config);
    const lida = lerConfiguracao(guardada);
    if (lida === undefined) throw new Error("configuração gravada não foi lida");
    expect(resolverAgenteDaEtapa(lida, "review").ferramentas).toEqual(["ler_contexto_review"]);
  });
});

describe("validação ao gravar", () => {
  it("recusa uma ferramenta fora do catálogo", () => {
    const resultado = ProjectConfig.safeParse({
      ...base,
      etapas: { spec: { ferramentas: ["ferramenta_inventada"] } },
    });
    expect(resultado.success).toBe(false);
  });

  it("recusa um prompt adicional que não é texto", () => {
    const resultado = ProjectConfig.safeParse({ ...base, etapas: { spec: { promptAdicional: 42 } } });
    expect(resultado.success).toBe(false);
  });

  it("recusa uma etapa que não existe", () => {
    const resultado = ProjectConfig.safeParse({ ...base, etapas: { inventada: { ferramentas: [] } } });
    expect(resultado.success).toBe(false);
  });
});

describe("ferramenta só vale na etapa que a implementa", () => {
  const base = {
    name: "P",
    source: { type: "github", project: "PROJ", repo: "dono/repo", assignee: "dono" },
    roles: { spec: { provider: "claude", model: "a" } },
    statuses: {},
  };

  it("recusa escrita ligada na etapa de review", () => {
    const r = ProjectConfig.safeParse({ ...base, etapas: { review: { ferramentas: ["escrever_arquivo"] } } });
    expect(r.success).toBe(false);
  });

  it("aceita o bash ligado na implementação", () => {
    const r = ProjectConfig.safeParse({ ...base, etapas: { implementacao: { ferramentas: ["executar_comando"] } } });
    expect(r.success).toBe(true);
  });

  it("recusa o bash ligado numa etapa que não o implementa", () => {
    const r = ProjectConfig.safeParse({ ...base, etapas: { spec: { ferramentas: ["executar_comando"] } } });
    expect(r.success).toBe(false);
  });
});
