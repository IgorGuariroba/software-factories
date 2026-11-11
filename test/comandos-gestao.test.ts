import { describe, expect, it } from "vitest";
import { interpretarComando, resolverTarefa, respostaDaPergunta } from "../src/packages/comandos-gestao/index.js";

// Comandos da gestão: /pausar e /retomar sem referência mexem no daemon; o comando aceita o @bot e a caixa; sem referência
// ou comando desconhecido é ajuda; a resposta separa o número e o texto; e a referência acha a Tarefa, sem ambiguidade.

describe("Comandos: interpretação", () => {
  it("pausar e retomar sem referência mexem no daemon, aceitam @bot e caixa", () => {
    expect(interpretarComando("/PAUSAR@fabrica_bot")).toEqual({ tipo: "pausa-daemon", pausar: true });
    expect(interpretarComando("/retomar")).toEqual({ tipo: "pausa-daemon", pausar: false });
  });

  it("comando de Tarefa exige a referência", () => {
    expect(interpretarComando("/vetar")).toEqual({ tipo: "ajuda" });
    expect(interpretarComando("/vetar sf/K-1")).toEqual({
      tipo: "tarefa",
      comando: "/vetar",
      referencia: "sf/K-1",
      texto: "/vetar sf/K-1",
    });
  });

  it("comando desconhecido é ajuda", () => {
    expect(interpretarComando("/nada sf/K-1")).toEqual({ tipo: "ajuda" });
  });
});

describe("Comandos: resposta de pergunta", () => {
  it("separa o número e o texto, mantendo quebras de linha", () => {
    expect(respostaDaPergunta("/responder sf/K-1 2 linha um\nlinha dois")).toEqual({
      n: 2,
      texto: "linha um\nlinha dois",
    });
  });

  it("sem número ou sem texto não é resposta", () => {
    expect(respostaDaPergunta("/responder sf/K-1 x texto")).toBeUndefined();
    expect(respostaDaPergunta("/responder sf/K-1 2")).toBeUndefined();
  });
});

describe("Comandos: referência da Tarefa", () => {
  const tarefas = [
    { id: "sf/K-1", key: "K-1" },
    { id: "outro/K-1", key: "K-1" },
    { id: "sf/K-2", key: "K-2" },
  ];

  it("id exato acha a Tarefa; chave sem projeto é ambígua se houver mais de uma", () => {
    expect(resolverTarefa(tarefas, "sf/K-1")).toEqual({ id: "sf/K-1" });
    expect(resolverTarefa(tarefas, "k-1")).toEqual({
      erro: "Há mais de uma Tarefa k-1; use projeto/chave: sf/K-1, outro/K-1.",
    });
  });

  it("chave única acha a Tarefa sem diferenciar caixa; ausente é erro", () => {
    expect(resolverTarefa(tarefas, "k-2")).toEqual({ id: "sf/K-2" });
    expect(resolverTarefa(tarefas, "K-9")).toEqual({ erro: "Não achei a Tarefa K-9." });
    expect(resolverTarefa(tarefas, "x/K-9")).toEqual({ erro: "Não achei a Tarefa x/K-9." });
  });
});

describe("Escalonador: rótulos ignorados", () => {
  it("épico é ignorado por padrão, sem diferenciar caixa; lista própria substitui o padrão", async () => {
    const { temRotuloIgnorado } = await import("../src/packages/fonte-demanda/index.js");
    expect(temRotuloIgnorado(["Epic"], undefined)).toBe(true);
    expect(temRotuloIgnorado(["epic"], ["outro"])).toBe(false);
    expect(temRotuloIgnorado(["outro"], ["OUTRO"])).toBe(true);
    expect(temRotuloIgnorado([], undefined)).toBe(false);
  });
});
