import { describe, expect, it } from "vitest";
import { traceDaConversa } from "../src/trace.js";

const usuario = (texto: string, timestamp = 1) => ({ model: [{ role: "user", content: texto, timestamp }] });

const agente = (blocos: unknown[], timestamp = 2) => ({
  model: [{ role: "assistant", content: blocos, model: "m", usage: { input: 10, output: 4 }, timestamp }],
});

const resultado = (ferramenta: string, texto: string, isError = false, timestamp = 3) => ({
  model: [
    {
      role: "toolResult",
      toolName: ferramenta,
      content: [{ type: "text", text: texto }],
      isError,
      timestamp,
    },
  ],
});

describe("trace de uma execução de etapa", () => {
  it("mantém a ordem das mensagens: pedido, texto do agente, chamada e resultado", () => {
    const passos = traceDaConversa([
      usuario("Leia a SPEC."),
      agente([
        { type: "text", text: "Vou ler o arquivo." },
        { type: "toolCall", id: "c1", name: "ler_arquivo", arguments: { caminho: "README.md" } },
      ]),
      resultado("ler_arquivo", "# Projeto"),
    ]);

    expect(passos.map((p) => p.tipo)).toEqual(["usuario", "agente", "chamada", "resultado"]);
    expect(passos[2]).toMatchObject({
      tipo: "chamada",
      ferramenta: "ler_arquivo",
      argumentos: { caminho: "README.md" },
    });
    expect(passos[3]).toMatchObject({
      tipo: "resultado",
      ferramenta: "ler_arquivo",
      resultado: "# Projeto",
      erro: false,
    });
  });

  it("marca o erro de uma ferramenta como erro, com o texto dele", () => {
    const passos = traceDaConversa([resultado("escrever_arquivo", "recusado: fora da raiz", true)]);
    expect(passos).toEqual([
      expect.objectContaining({
        tipo: "resultado",
        ferramenta: "escrever_arquivo",
        erro: true,
        resultado: "recusado: fora da raiz",
      }),
    ]);
  });

  it("registra o uso de tokens da resposta do agente", () => {
    const [passo] = traceDaConversa([agente([{ type: "text", text: "pronto" }])]);
    expect(passo).toMatchObject({ tipo: "agente", uso: { entrada: 10, saida: 4 } });
  });

  it("redige segredos nos argumentos e nos resultados", () => {
    const passos = traceDaConversa([
      agente([
        {
          type: "toolCall",
          id: "c2",
          name: "rodar_testes",
          arguments: { comando: "TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 npm test" },
        },
      ]),
      resultado("rodar_testes", "saída com ghp_abcdefghijklmnopqrstuvwxyz0123456789 vazada"),
    ]);
    const texto = JSON.stringify(passos);
    expect(texto).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("ignora entradas sem mensagens, como as de controle da conversa", () => {
    const passos = traceDaConversa([{ kind: "control" }, usuario("oi")]);
    expect(passos.map((p) => p.tipo)).toEqual(["usuario"]);
  });

  it("devolve vazio para uma conversa sem entradas", () => {
    expect(traceDaConversa([])).toEqual([]);
  });
});
