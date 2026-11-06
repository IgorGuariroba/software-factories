import type { ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { Card } from "../src/demand-source.js";
import { classifyTriage } from "../src/triage.js";

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
        ...(context.questions.duplicata ? { duplicata: choice([a.duplicata ?? "nenhuma", 0.9]) } : {}),
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
