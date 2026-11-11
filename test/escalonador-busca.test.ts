import { describe, expect, it, vi } from "vitest";
import {
  buscarNaFonte,
  type CardBusca,
  cardsElegiveis,
  type ItemBusca,
  type PortasBuscaCompleta,
  type ProjetoBusca,
} from "../src/packages/escalonador/index.js";

// Busca na Fonte com portas falsas: fixa quem entra na fila (responsável, estado elegível, chaves do projeto), quem fica
// de fora (repositório desativado, projeto pausado ou incompleto), a ordem das issues do GitHub, e que uma falha de
// sincronização não impede a busca dos cards.

const statuses = { aberta: "todo", andamento: "in_progress", fechada: "done" };

function projeto(nome: string, cards: CardBusca[], extra: Partial<ProjetoBusca> = {}): ProjetoBusca {
  return {
    nome,
    github: true,
    assignee: "ana",
    statuses,
    listarAtribuidos: async () => cards,
    ...extra,
  };
}

const card = (key: string, extra: Partial<CardBusca> = {}): CardBusca => ({
  key,
  title: `Card ${key}`,
  status: "aberta",
  assignee: "ana",
  ...extra,
});

function portasFalsas(projetos: ProjetoBusca[], sobrescritas: Partial<PortasBuscaCompleta> = {}) {
  const enfileirados: ItemBusca[][] = [];
  const erros: unknown[] = [];
  const portas: PortasBuscaCompleta = {
    projetos: () => projetos,
    estado: async () => ({}),
    repoDesativado: () => false,
    projetoPausado: () => false,
    pendenciasBloqueantes: () => [],
    sincronizarRepositorios: async () => undefined,
    registrarErroSincronizacao: (erro) => {
      erros.push(erro);
    },
    verificarPerguntas: vi.fn(async () => undefined),
    enfileirar: async (itens) => {
      enfileirados.push(itens);
    },
    ...sobrescritas,
  };
  return { portas, enfileirados, erros };
}

describe("Busca: quem entra na fila", () => {
  it("só entra o card do responsável, em estado elegível", async () => {
    const { portas } = portasFalsas([
      projeto("sf", [
        card("SF-1"),
        card("SF-2", { status: "andamento" }),
        card("SF-3", { status: "fechada" }),
        card("SF-4", { assignee: "bruno" }),
      ]),
    ]);
    expect((await cardsElegiveis(portas)).map((i) => i.key)).toEqual(["SF-1", "SF-2"]);
  });

  it("com lista de chaves, só entram as chaves do projeto", async () => {
    const { portas } = portasFalsas([projeto("sf", [card("SF-1"), card("SF-2")], { keys: ["SF-2"] })]);
    expect((await cardsElegiveis(portas)).map((i) => i.key)).toEqual(["SF-2"]);
  });

  it("repositório desativado, projeto pausado ou incompleto ficam de fora", async () => {
    const cards = [card("SF-1")];
    const desativado = portasFalsas([projeto("a", cards)], { repoDesativado: () => true });
    const pausado = portasFalsas([projeto("b", cards)], { projetoPausado: () => true });
    const incompleto = portasFalsas([projeto("c", cards)], { pendenciasBloqueantes: () => ["falta PO"] });
    expect(await cardsElegiveis(desativado.portas)).toEqual([]);
    expect(await cardsElegiveis(pausado.portas)).toEqual([]);
    expect(await cardsElegiveis(incompleto.portas)).toEqual([]);
  });

  it("issues de repositório monitorado vêm das mais antigas para as mais novas", async () => {
    const { portas } = portasFalsas([projeto("sf", [card("SF-10"), card("SF-2"), card("SF-7")])]);
    expect((await cardsElegiveis(portas)).map((i) => i.key)).toEqual(["SF-2", "SF-7", "SF-10"]);
  });

  it("Fonte que não é repositório monitorado mantém a ordem da Fonte", async () => {
    const { portas } = portasFalsas([projeto("jira", [card("PROJ-9"), card("PROJ-2")], { github: false })]);
    expect((await cardsElegiveis(portas)).map((i) => i.key)).toEqual(["PROJ-9", "PROJ-2"]);
  });
});

describe("Busca: sequência", () => {
  it("sincroniza, confere as perguntas e enfileira os elegíveis", async () => {
    const { portas, enfileirados } = portasFalsas([projeto("sf", [card("SF-1")])]);
    await buscarNaFonte(portas);
    expect(portas.verificarPerguntas).toHaveBeenCalledTimes(1);
    expect(enfileirados).toEqual([[expect.objectContaining({ project: "sf", key: "SF-1", state: "todo" })]]);
  });

  it("falha na sincronização é registrada e a busca dos cards segue", async () => {
    const falha = new Error("github fora");
    const { portas, enfileirados, erros } = portasFalsas([projeto("sf", [card("SF-1")])], {
      sincronizarRepositorios: async () => {
        throw falha;
      },
    });
    await buscarNaFonte(portas);
    expect(erros).toEqual([falha]);
    expect(enfileirados[0]).toHaveLength(1);
  });
});
