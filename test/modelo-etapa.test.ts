import { describe, expect, it } from "vitest";
import { chamadaDaUltimaRodada, EXECUCAO_DE_ENTREGA } from "../src/packages/modelo-etapa/index.js";

// Leitura da entrega na transcrição: acha a chamada da ferramenta de entrega na rodada do pedido atual; para na mensagem do
// usuário (uma rodada antiga não vale); e a execução da entrega só encerra a rodada.

const assistente = (...blocos: unknown[]) => ({ model: [{ role: "assistant", content: blocos }] });
const usuario = { model: [{ role: "user", content: "oi" }] };
const chamada = (name: string, args: unknown) => ({ type: "toolCall", name, arguments: args });

describe("Modelo: chamada da entrega", () => {
  it("acha a chamada da ferramenta pedida na rodada mais recente", () => {
    const itens = [assistente(chamada("entregar", { x: 1 }))];
    expect(chamadaDaUltimaRodada(itens, ["entregar"])).toEqual({ name: "entregar", arguments: { x: 1 } });
  });

  it("aceita qualquer um dos nomes pedidos", () => {
    const itens = [assistente(chamada("perguntar", { p: "?" }))];
    expect(chamadaDaUltimaRodada(itens, ["entregar", "perguntar"])?.name).toBe("perguntar");
  });

  it("para na mensagem do usuário: uma chamada anterior a ela não vale", () => {
    const itens = [usuario, assistente(chamada("entregar", {}))];
    expect(chamadaDaUltimaRodada(itens, ["entregar"])).toBeUndefined();
  });

  it("sem a ferramenta pedida, não acha nada; outras ferramentas e mensagens sem bloco de chamada são ignoradas", () => {
    expect(chamadaDaUltimaRodada([assistente(chamada("outra", {}))], ["entregar"])).toBeUndefined();
    expect(
      chamadaDaUltimaRodada([{ model: [{ role: "assistant", content: "texto solto" }] }], ["entregar"]),
    ).toBeUndefined();
  });
});

describe("Modelo: execução da entrega", () => {
  it("só encerra a rodada, com o texto de recebido", async () => {
    expect(await EXECUCAO_DE_ENTREGA()).toEqual({
      output: [{ type: "text", text: "Recebido." }],
      control: { terminate: true },
    });
  });
});
