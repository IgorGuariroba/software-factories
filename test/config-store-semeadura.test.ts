import { describe, expect, it } from "vitest";
import { lerConfiguracao, semearConfiguracoes } from "../src/packages/config-store/index.js";
import { testProjectConfig } from "./harness.js";

describe("semeadura de configurações de projeto (ADR-0017)", () => {
  it("semeia só os projetos do YAML que ainda não estão guardados, sem trocar os guardados", () => {
    const guardado = testProjectConfig({ name: "ja-guardado", dryRun: true });
    const doYaml = testProjectConfig({ name: "ja-guardado", dryRun: false });
    const novo = testProjectConfig({ name: "novo" });

    const proximas = semearConfiguracoes({ "ja-guardado": JSON.stringify(guardado) }, [doYaml, novo]);

    expect(lerConfiguracao(proximas["ja-guardado"])?.dryRun).toBe(true);
    expect(lerConfiguracao(proximas.novo)?.name).toBe("novo");
  });

  it("lê uma configuração guardada inválida como ausente, sem lançar erro", () => {
    expect(lerConfiguracao(JSON.stringify({ name: "x" }))).toBeUndefined();
    expect(lerConfiguracao(undefined)).toBeUndefined();
  });
});
