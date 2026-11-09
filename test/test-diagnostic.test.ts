import { expect, it } from "vitest";
import { testDiagnostic } from "../src/test-diagnostic.js";

it("prioriza o detalhe da falha e remove escapes ANSI", () => {
  const output = "\x1b[32m✓ sucesso\x1b[0m\nFAIL teste de retomada\nAssertionError: esperado bloqueada\n";
  expect(testDiagnostic(output)).toBe("FAIL teste de retomada\nAssertionError: esperado bloqueada\n");
});

it("limita o diagnóstico sem perder o início da falha", () => {
  expect(testDiagnostic("FAIL " + "x".repeat(100), 20)).toBe("FAIL " + "x".repeat(15) + "\n[…diagnóstico truncado]");
  expect(testDiagnostic("bwrap: permissão negada")).toBe("bwrap: permissão negada");
});
