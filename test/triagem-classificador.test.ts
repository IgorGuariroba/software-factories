import type { ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { Card } from "../src/demand-source.js";
import { classifyTriage } from "../src/triage-classificador.js";

const card = (n: number, title: string): Card => ({
  key: `SF-${n}`,
  title,
  status: "aberta",
  assignee: "dono",
  description: "Texto da issue.",
});

type Answers = {
  decisao: [string, number];
  categoria?: [string, number];
  injecao?: number;
  duplicata?: string;
  duplicataConfidence?: number;
};
/** Classificador fake: responde `answers` e guarda o contexto recebido. */
function classifier(a: Answers, stopReason: ClassifierResult["stopReason"] = "stop") {
  const seen: ClassifierContext[] = [];
  const classify = async (context: ClassifierContext): Promise<ClassifierResult> => {
    seen.push(context);
    const choice = ([choice, confidence]: [string, number]) => ({
      type: "choice" as const,
      choice,
      confidence,
      probabilities: { [choice]: confidence },
    });
    return {
      api: "typesafe-system-one",
      provider: "openrouter",
      model: "typesafe/jev-1.14",
      stopReason,
      timestamp: 0,
      answers: {
        decisao: choice(a.decisao),
        categoria: choice(a.categoria ?? ["ok", 0.9]),
        injecao: { type: "bool", probability: a.injecao ?? 0.02 },
        ...(context.questions.duplicata
          ? { duplicata: choice([a.duplicata ?? "nenhuma", a.duplicataConfidence ?? 0.9]) }
          : {}),
      },
    };
  };
  return { classify, seen };
}
const input = { card: card(7, "Exportar CSV"), comments: [], others: [], recentCommits: [], knowledge: undefined };

describe("triagem por classificador (System One, ex.: Jev)", () => {
  it("aceita com confiança alta segue; o conteúdo inteiro da issue vai no state", async () => {
    const c = classifier({ decisao: ["aceita", 0.98] });
    const r = await classifyTriage({ ...input, classify: c.classify });
    expect(r).toMatchObject({ verdict: "aceita", category: "ok", by: "modelo" });
    expect(r.reason).toMatch(/aceita 98%/);
    expect(JSON.stringify(c.seen[0]?.state)).toContain("Exportar CSV");
    expect(c.seen[0]?.questions.duplicata).toBeUndefined();
  });

  it("injeção provável vira duvidosa por segurança, mesmo que a decisão seja aceita", async () => {
    const r = await classifyTriage({
      ...input,
      classify: classifier({ decisao: ["aceita", 0.9], injecao: 0.99 }).classify,
    });
    expect(r).toMatchObject({ verdict: "duvidosa", category: "seguranca" });
    expect(r.reason).toMatch(/injeção 99%/);
  });

  it("confiança baixa vira duvidosa; aceita com categoria de problema também", async () => {
    expect(
      (await classifyTriage({ ...input, classify: classifier({ decisao: ["recusa", 0.45] }).classify })).verdict,
    ).toBe("duvidosa");
    const contradicts = await classifyTriage({
      ...input,
      classify: classifier({ decisao: ["aceita", 0.9], categoria: ["escopo", 0.8] }).classify,
    });
    expect(contradicts).toMatchObject({ verdict: "duvidosa", category: "escopo" });
  });

  it("resposta fora das opções ou com número inválido vai ao usuário", async () => {
    for (const decisao of [
      ["fechar", 0.99],
      ["recusa", Number.NaN],
    ] as [string, number][]) {
      const r = await classifyTriage({
        ...input,
        classify: classifier({ decisao, categoria: ["escopo", 0.9] }).classify,
      });
      expect(r.verdict).toBe("duvidosa");
    }
  });

  it("duplicata de uma issue mais nova vai ao usuário", async () => {
    const r = await classifyTriage({
      ...input,
      others: [card(9, "Planilha")],
      classify: classifier({ decisao: ["recusa", 0.9], categoria: ["duplicata", 0.9], duplicata: "SF-9" }).classify,
    });
    expect(r.verdict).toBe("duvidosa");
  });

  it("aceita, mas apontada como duplicata com confiança: vai ao usuário; com confiança baixa, a duplicata é ignorada", async () => {
    const others = [card(3, "Planilha")];
    const sure = await classifyTriage({
      ...input,
      others,
      classify: classifier({ decisao: ["aceita", 0.9], duplicata: "SF-3" }).classify,
    });
    expect(sure).toMatchObject({ verdict: "duvidosa", category: "duplicata", duplicateOf: "SF-3" });
    const noisy = await classifyTriage({
      ...input,
      others,
      classify: classifier({ decisao: ["aceita", 0.9], duplicata: "SF-3", duplicataConfidence: 0.4 }).classify,
    });
    expect(noisy).toMatchObject({ verdict: "aceita" });
    expect(noisy.reason).not.toMatch(/duplicata/);
  });

  it("categoria duplicata numa aceita: vai ao usuário e mantém a referência", async () => {
    const r = await classifyTriage({
      ...input,
      others: [card(3, "Planilha")],
      classify: classifier({ decisao: ["aceita", 0.9], categoria: ["duplicata", 0.9], duplicata: "SF-3" }).classify,
    });
    expect(r).toMatchObject({ verdict: "duvidosa", category: "duplicata", duplicateOf: "SF-3" });
  });

  it("as outras issues vão com a descrição: títulos genéricos não bastam para comparar", async () => {
    const c = classifier({ decisao: ["aceita", 0.9] });
    const a = { ...card(3, "Melhorias"), description: "Exportar o relatório em PDF." };
    const b = { ...card(4, "Melhorias"), description: "Trocar a cor do botão de login." };
    await classifyTriage({ ...input, others: [a, b], classify: c.classify });
    const sent = JSON.stringify(c.seen[0]?.state);
    expect(sent).toContain("Exportar o relatório em PDF.");
    expect(sent).toContain("Trocar a cor do botão de login.");
  });

  it("a categoria segurança é para ação perigosa, não para issue que só trata do tema", async () => {
    const c = classifier({ decisao: ["aceita", 0.9] });
    await classifyTriage({ ...input, classify: c.classify });
    const categoria = c.seen[0]?.questions.categoria as { criteria: Record<string, string> } | undefined;
    expect(categoria?.criteria.seguranca).toMatch(/só trata de segurança como tema/);
  });

  it("recusa com categoria ok é contraditória: vai ao usuário", async () => {
    const r = await classifyTriage({ ...input, classify: classifier({ decisao: ["recusa", 0.9] }).classify });
    expect(r.verdict).toBe("duvidosa");
  });

  it("duplicata semântica: pergunta entre as outras issues abertas e aponta a escolhida", async () => {
    const c = classifier({ decisao: ["recusa", 0.9], categoria: ["duplicata", 0.9], duplicata: "SF-3" });
    const r = await classifyTriage({
      ...input,
      others: [card(3, "Baixar relatório como planilha")],
      classify: c.classify,
    });
    expect(c.seen[0]?.questions.duplicata).toMatchObject({ type: "choice" });
    const asked = c.seen[0]?.questions.duplicata as { criteria: object } | undefined;
    expect(Object.keys(asked?.criteria ?? {})).toEqual(["SF-3", "nenhuma"]);
    expect(r).toMatchObject({ verdict: "recusa", category: "duplicata", duplicateOf: "SF-3", closeAs: "duplicate" });
  });

  it("erro do classificador falha a triagem (a Tarefa tenta de novo), sem decidir nada", async () => {
    await expect(
      classifyTriage({ ...input, classify: classifier({ decisao: ["aceita", 1] }, "error").classify }),
    ).rejects.toThrow(/classificador/);
  });
});
