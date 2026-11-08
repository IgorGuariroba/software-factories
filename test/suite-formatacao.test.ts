import { expect, it } from "vitest";
import { executarVerificacaoDaSuite } from "../scripts/verificar-suite.js";

const obrigatorios = [
  "test/prazo-util.test.ts",
  "test/perguntas-tecnicas.test.ts",
  "test/encaminhamento-tecnico.test.ts",
  "test/repositorio-nao-identificado.test.ts",
  "test/destinatarios-projeto.test.ts",
  "test/implementacao.test.ts",
];

it("mantém a suíte real verde após os ajustes de lint e formatação", () => {
  // Contrato do verificador: executar o Vitest real do projeto, incluindo o
  // teste de lint, sem modificar arquivos nem substituir testes por mocks.
  // Somente este orquestrador pode ser excluído da execução filha, para evitar
  // recursão. Os arquivos de comportamento exigidos precisam aparecer no relatório.
  const resultado = executarVerificacaoDaSuite();
  const saida = [resultado.stdout, resultado.stderr].filter(Boolean).join("\n");
  const diagnostico = [resultado.error?.message, saida.slice(-16_000)].filter(Boolean).join("\n");

  expect(resultado.error, diagnostico).toBeUndefined();
  expect(resultado.signal, diagnostico).toBeNull();
  expect(resultado.status, diagnostico).toBe(0);
  for (const arquivo of obrigatorios) {
    expect(saida, `A suíte precisa executar ${arquivo}`).toContain(arquivo);
  }
}, 130_000);
