import { describe, expect, it } from "vitest";
import { envelopeMinimoLegado } from "../src/packages/mensagens-gestao/lib/envelope.js";

// Filas legadas sem `source`: o envelope mínimo não reenvia o texto completo persistido.

describe("envelopeMinimoLegado", () => {
  it("pergunta com rascunho não enviado vira aviso curto com a instrução de revisão", () => {
    const r = envelopeMinimoLegado({
      project: "app",
      message: {
        text: "Pergunta 2 sobre ABC-1 (po): qual o prazo?\nRascunho não enviado ao PO.",
        buttons: [{ label: "Responder", command: "/responder" }],
      },
    });
    expect(r.text).toBe(
      "Pergunta 2 sobre ABC-1 (po). Consulte a interface web local para ver o conteúdo.\nRascunho não enviado ao PO. Para publicar, revise e aprove na interface web local. /responder registra uma resposta local, sem publicar a pergunta.",
    );
    expect(r.buttons).toEqual([{ label: "Responder", command: "/responder" }]);
  });

  it("mantém o prefixo entre colchetes", () => {
    const r = envelopeMinimoLegado({
      project: "app",
      message: { text: "[app] Assumi o card X-9 (github): começando" },
    });
    expect(r.text).toBe("[app] Assumi o card X-9 (github).");
  });

  it("aviso oculto cita o projeto e não repete o conteúdo", () => {
    const r = envelopeMinimoLegado({ project: "app", message: { text: "Aviso: segredo qualquer" } });
    expect(r.text).toBe("Aviso (conteúdo oculto) no projeto app. Consulte a interface web local para ver o conteúdo.");
  });

  it("texto desconhecido vira aviso genérico do projeto", () => {
    const r = envelopeMinimoLegado({ project: "app", message: { text: "algo sem formato conhecido" } });
    expect(r.text).toBe("Aviso do projeto app. Consulte a interface web local para ver o conteúdo.");
  });
});
