import { stripVTControlCharacters } from "node:util";

/** Remove cores de terminal e prioriza a falha, não a lista de testes que passaram. */
export function testDiagnostic(output: string, limit = 2000): string {
  const plain = stripVTControlCharacters(output);
  const lines = plain.split("\n");
  const detailedFailure = lines.findIndex((line) =>
    /^\s*(FAIL\b|Error:|AssertionError:|TypeError:|SyntaxError:|not ok\b)/i.test(line),
  );
  const firstFailure =
    detailedFailure >= 0 ? detailedFailure : lines.findIndex((line) => /^\s*(Failed Tests\b|×|❯.*failed)/i.test(line));
  const detail = firstFailure < 0 ? plain : lines.slice(firstFailure).join("\n");
  return detail.length <= limit ? detail : `${detail.slice(0, limit)}\n[…diagnóstico truncado]`;
}
