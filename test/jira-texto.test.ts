import { describe, expect, it } from "vitest";
import { adfToText, findCommentId, isTextAttachment, textToAdf } from "../src/packages/jira-texto/index.js";

// Texto do Jira: a ida (texto da fábrica para ADF) mantém a menção como nó próprio, a volta devolve texto, a regra de
// anexo separa o que é texto do que é binário, e o id do comentário sai de qualquer formato de resposta.

describe("Jira: ADF", () => {
  it("menção [~accountid:ID] vira nó de menção, o resto é texto", () => {
    const doc = textToAdf("Oi [~accountid:abc] tudo bem") as { content: { content: unknown[] }[] };
    const inline = doc.content[0].content;
    expect(inline).toEqual([
      { type: "text", text: "Oi " },
      { type: "mention", attrs: { id: "abc" } },
      { type: "text", text: " tudo bem" },
    ]);
  });

  it("texto sem menção é um parágrafo só de texto", () => {
    const doc = textToAdf("simples") as { content: { type: string; content: unknown[] }[] };
    expect(doc.content[0]).toMatchObject({ type: "paragraph", content: [{ type: "text", text: "simples" }] });
  });

  it("ida e volta devolvem o texto dos parágrafos", () => {
    const texto = adfToText(textToAdf("primeira\n\nsegunda"));
    expect(texto).toContain("primeira");
    expect(texto).toContain("segunda");
  });
});

describe("Jira: anexo de texto", () => {
  it("texto pelo nome ou pelo tipo de mídia é anexo de texto", () => {
    expect(isTextAttachment("notas.md")).toBe(true);
    expect(isTextAttachment("dados.dat", "text/csv")).toBe(true);
    expect(isTextAttachment("config.json", "application/json")).toBe(true);
  });

  it("binário conhecido não é texto, mesmo com tipo de mídia de texto", () => {
    expect(isTextAttachment("foto.png", "text/plain")).toBe(false);
    expect(isTextAttachment("pacote.zip")).toBe(false);
  });

  it("extensão binária vence o tipo de mídia de texto", () => {
    expect(isTextAttachment("dados.bin", "text/csv")).toBe(false);
  });

  it("sem nome nem tipo de texto, não é texto", () => {
    expect(isTextAttachment("arquivo.desconhecido")).toBe(false);
  });
});

describe("Jira: id de comentário", () => {
  it("acha o id em {id}, {comment:{id}} e em lista", () => {
    expect(findCommentId({ id: "10" })).toBe("10");
    expect(findCommentId({ comment: { id: "11" } })).toBe("11");
    expect(findCommentId([{ id: "12" }])).toBe("12");
  });

  it("sem id, devolve undefined", () => {
    expect(findCommentId({ outro: 1 })).toBeUndefined();
    expect(findCommentId(null)).toBeUndefined();
  });
});
