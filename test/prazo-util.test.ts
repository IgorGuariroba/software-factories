import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calcularPrazoUtil } from "../src/prazo-util.js";

// Contrato: calcularPrazoUtil({ minutosUteis, relogio: () => Date }): Date.
// Calendário fixo: America/Sao_Paulo, seg–sex, [09:00, 18:00),
// sem feriados nacionais, estaduais de SP e municipais de Mogi das Cruzes.
describe("prazo de 120 minutos úteis em Mogi das Cruzes/SP", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const casos = [
    {
      nome: "conta exatamente 120 minutos dentro do expediente",
      inicio: "2025-06-10T10:00:00-03:00",
      fim: "2025-06-10T12:00:00-03:00",
    },
    {
      nome: "aceita o início às 09:00 de São Paulo (12:00 UTC)",
      inicio: "2025-06-10T12:00:00Z",
      fim: "2025-06-10T11:00:00-03:00",
    },
    {
      nome: "permite que o prazo termine exatamente no limite das 18:00",
      inicio: "2025-06-10T16:00:00-03:00",
      fim: "2025-06-10T18:00:00-03:00",
    },
    {
      nome: "preserva o minuto restante quando ultrapassa o limite do expediente",
      inicio: "2025-06-10T16:01:00-03:00",
      fim: "2025-06-11T09:01:00-03:00",
    },
    {
      nome: "começa às 09:00 quando o relógio está antes do expediente",
      inicio: "2025-06-10T07:30:00-03:00",
      fim: "2025-06-10T11:00:00-03:00",
    },
    {
      nome: "início exatamente às 18:00 não consome minutos naquele dia",
      inicio: "2025-06-10T18:00:00-03:00",
      fim: "2025-06-11T11:00:00-03:00",
    },
    {
      nome: "início após o expediente avança para o próximo dia útil",
      inicio: "2025-06-10T20:00:00-03:00",
      fim: "2025-06-11T11:00:00-03:00",
    },
    {
      nome: "divide os minutos entre dois expedientes",
      inicio: "2025-06-10T17:30:00-03:00",
      fim: "2025-06-11T10:30:00-03:00",
    },
    {
      nome: "atravessa o fim de semana sem contar sábado nem domingo",
      inicio: "2025-06-13T17:00:00-03:00",
      fim: "2025-06-16T10:00:00-03:00",
    },
    {
      nome: "normaliza início no sábado",
      inicio: "2025-06-14T10:00:00-03:00",
      fim: "2025-06-16T11:00:00-03:00",
    },
    {
      nome: "normaliza início no domingo",
      inicio: "2025-06-15T10:00:00-03:00",
      fim: "2025-06-16T11:00:00-03:00",
    },
    {
      nome: "exclui feriado nacional: Natal",
      inicio: "2025-12-24T17:00:00-03:00",
      fim: "2025-12-26T10:00:00-03:00",
    },
    {
      nome: "normaliza início em feriado nacional: Consciência Negra",
      inicio: "2025-11-20T10:00:00-03:00",
      fim: "2025-11-21T11:00:00-03:00",
    },
    {
      nome: "exclui feriado estadual de SP: Revolução Constitucionalista",
      inicio: "2025-07-08T17:00:00-03:00",
      fim: "2025-07-10T10:00:00-03:00",
    },
    {
      nome: "normaliza início no feriado estadual de 9 de julho",
      inicio: "2025-07-09T10:00:00-03:00",
      fim: "2025-07-10T11:00:00-03:00",
    },
    {
      nome: "exclui feriado municipal: aniversário de Mogi das Cruzes",
      inicio: "2025-08-29T17:00:00-03:00",
      fim: "2025-09-02T10:00:00-03:00",
    },
    {
      nome: "normaliza início no feriado municipal de 1º de setembro",
      inicio: "2025-09-01T10:00:00-03:00",
      fim: "2025-09-02T11:00:00-03:00",
    },
    {
      nome: "atravessa a virada do ano excluindo o feriado nacional de Ano Novo",
      inicio: "2025-12-31T17:00:00-03:00",
      fim: "2026-01-02T10:00:00-03:00",
    },
  ];

  it.each(casos)("$nome", ({ inicio, fim }) => {
    vi.setSystemTime(new Date(inicio));
    const relogio = vi.fn(() => new Date());

    const prazo = calcularPrazoUtil({ minutosUteis: 120, relogio });

    expect(relogio).toHaveBeenCalled();
    expect(prazo).toBeInstanceOf(Date);
    expect(prazo.toISOString()).toBe(new Date(fim).toISOString());
  });

  it("usa o relógio injetado, não a data real/global do processo", () => {
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const instante = new Date("2025-06-10T10:00:00-03:00");
    const relogio = vi.fn(() => instante);

    const prazo = calcularPrazoUtil({ minutosUteis: 120, relogio });

    expect(relogio).toHaveBeenCalled();
    expect(prazo.toISOString()).toBe("2025-06-10T15:00:00.000Z");
    expect(instante.toISOString()).toBe("2025-06-10T13:00:00.000Z");
  });
});
