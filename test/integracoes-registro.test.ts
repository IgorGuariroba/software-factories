import { describe, expect, it } from "vitest";
import { createIntegrationRegistry } from "../src/packages/integracoes/index.js";

describe("registro de integrações por tipo", () => {
  it("cria a integração do tipo registrado a partir da configuração", () => {
    const registro = createIntegrationRegistry<{ project: string }, { nome: string }>("Fonte");
    registro.register("jira", (config) => ({ nome: `jira:${config.project}` }));

    expect(registro.create("jira", { project: "PROJ" })).toEqual({ nome: "jira:PROJ" });
  });

  it("recusa um tipo que não foi registrado, com mensagem que nomeia o tipo", () => {
    const registro = createIntegrationRegistry<{ project: string }, { nome: string }>("Fonte");
    registro.register("jira", (config) => ({ nome: config.project }));

    expect(() => registro.create("gitlab", { project: "PROJ" })).toThrow('Fonte "gitlab" não disponível');
  });

  it("informa quais tipos estão registrados, sem duplicar", () => {
    const registro = createIntegrationRegistry<unknown, unknown>("Canal");
    registro.register("card-comment", () => ({}));
    registro.register("teams", () => ({}));

    expect(registro.tipos()).toEqual(["card-comment", "teams"]);
    expect(registro.tem("teams")).toBe(true);
    expect(registro.tem("telegram")).toBe(false);
  });

  it("recusa registrar o mesmo tipo duas vezes", () => {
    const registro = createIntegrationRegistry<unknown, unknown>("Fonte");
    registro.register("jira", () => ({}));

    expect(() => registro.register("jira", () => ({}))).toThrow('Fonte "jira" já está registrada');
  });
});
