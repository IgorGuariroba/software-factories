import { expect, it } from "vitest";
import { implementationSummary } from "../web/implementation.js";

const tickets = [
  { titulo: "Primeiro", aceite: "Preservar critério" },
  { titulo: "Segundo", aceite: "Outro critério" },
];
it("distingue GREEN, RED e espera sem inferir aprovação de review ou merge", () => {
  const result = implementationSummary({
    tickets,
    implementation: {
      commits: [
        { ticket: 0, phase: "teste", sha: "red" },
        { ticket: 0, phase: "implementacao", sha: "green" },
        { ticket: 1, phase: "teste", sha: "red-2" },
      ],
    },
  });
  expect(result.completed).toBe(1);
  expect(result.tickets.map((ticket) => ticket.state)).toEqual(["green", "red"]);
  expect(result.next?.number).toBe(2);
  expect(result.tickets[0].aceite).toBe("Preservar critério");
  expect(result.tickets[0].records).toHaveLength(2);
});
it("preserva os tickets planejados sem implementação e trata tarefa sem tickets", () => {
  expect(implementationSummary({ tickets }).tickets.map((ticket) => ticket.state)).toEqual(["pending", "pending"]);
  expect(implementationSummary({ tickets: [] })).toEqual({ tickets: [], completed: 0, next: null });
});
it("conta tickets, não o número de commits, e não inventa próximo ticket ao terminar", () => {
  const result = implementationSummary({
    tickets,
    implementation: {
      commits: [
        { ticket: 0, phase: "implementacao", sha: "a" },
        { ticket: 0, phase: "implementacao", sha: "b" },
        { ticket: 1, phase: "implementacao", sha: "c" },
      ],
    },
  });
  expect(result.completed).toBe(2);
  expect(result.next).toBeNull();
});
it("mostra critério reavaliado sem fingir que houve commits RED/GREEN", () => {
  const result = implementationSummary({
    tickets,
    implementation: {
      commits: [{ ticket: 0, phase: "implementacao", sha: "a" }],
      verifiedTickets: [{ ticket: 1, sha: "a" }],
    },
  });
  expect(result.completed).toBe(2);
  expect(result.tickets[1].label).toContain("review independente");
  expect(result.tickets[1].records).toEqual([]);
  expect(result.next).toBeNull();
});
