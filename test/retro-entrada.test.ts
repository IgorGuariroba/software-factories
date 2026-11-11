import { describe, expect, it } from "vitest";
import { entradaDaRetro, type TarefaRetrospectiva } from "../src/packages/retro-etapa/index.js";

// Texto de entrada da retrô: fixa o cabeçalho e os campos de cada etapa, que incidentes entram (só erro e barrada), e que
// a retrô consolidada deixa de fora a própria etapa `tarefa`.

const base: TarefaRetrospectiva = { attempts: 2, questions: [], delivery: null, implementation: null, retros: [] };

describe("Retrô: texto de entrada", () => {
  it("sempre lista tentativas, perguntas e incidentes (erro e barrada apenas)", () => {
    const texto = entradaDaRetro(
      "spec",
      { ...base, questions: [{ n: 1, origin: "grill", text: "Qual prazo?" }], delivery: { spec: "S", tickets: [] } },
      [{ type: "error", message: "falhou o git" }, { type: "blocked", reason: "CI" }, { type: "progress" }],
    );
    expect(texto).toContain("Tentativas da Tarefa depois de falhas: 2.");
    expect(texto).toContain("- pergunta 1 (grill): Qual prazo?");
    expect(texto).toContain("Incidentes registrados: 2.");
    expect(texto).toContain("- erro: falhou o git");
    expect(texto).toContain("- barrada: CI");
    expect(texto).not.toContain("progress");
  });

  it("SPEC mostra a entrega e os tickets numerados", () => {
    const texto = entradaDaRetro(
      "spec",
      { ...base, delivery: { spec: "SPEC X", tickets: [{ titulo: "A", aceite: "ok" }] } },
      [],
    );
    expect(texto.startsWith("# Retrô da etapa SPEC")).toBe(true);
    expect(texto).toContain("SPEC X");
    expect(texto).toContain("## Tickets (1)");
    expect(texto).toContain("1. A: ok");
  });

  it("implementação conta recusas sem deixar o número negativo", () => {
    const texto = entradaDaRetro(
      "implementacao",
      {
        ...base,
        implementation: {
          requests: 1,
          commits: [
            { ticket: 0, phase: "implementacao" },
            { ticket: 1, phase: "correcao" },
          ],
          pushed: true,
        },
      },
      [],
    );
    expect(texto).toContain("Pedidos ao implementador: 1; commits aceitos: 2; pedidos recusados ou sem resposta: 0.");
    expect(texto).toContain("- ticket 1, fase implementacao");
    expect(texto).toContain("Push da branch: feito.");
  });

  it("triagem, revisão e MR incluem o registro da etapa em JSON", () => {
    const texto = entradaDaRetro("review", { ...base, review: { head: "abc" } }, []);
    expect(texto.startsWith("# Retrô da etapa review")).toBe(true);
    expect(texto).toContain('{"head":"abc"}');
  });

  it("consolidada lista as retrôs das etapas sem a própria etapa tarefa", () => {
    const texto = entradaDaRetro(
      "tarefa",
      {
        ...base,
        retros: [
          {
            stage: "spec",
            status: "concluida",
            summary: "bom",
            proposals: [{ kind: "fabrica", title: "T", description: "D" }],
          },
          { stage: "tarefa", status: "concluida", summary: "eu mesma" },
        ],
      },
      [],
    );
    expect(texto).toContain("### spec (concluida)");
    expect(texto).toContain("- [fabrica] T: D");
    expect(texto).not.toContain("eu mesma");
  });
});
