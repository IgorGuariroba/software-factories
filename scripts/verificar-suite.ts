import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Executa a suíte instalada no repositório, sem shell, mocks ou escritas nos fontes.
 * Apenas o teste orquestrador é excluído da execução filha, para evitar recursão.
 * O teste de lint e todos os testes de comportamento continuam habilitados.
 */
export function executarVerificacaoDaSuite(): SpawnSyncReturns<string> {
  const raiz = fileURLToPath(new URL("../", import.meta.url));
  const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));

  return spawnSync(
    process.execPath,
    [vitest, "run", "--exclude", "test/suite-formatacao.test.ts", "--maxWorkers=2", "--reporter=default"],
    {
      cwd: raiz,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
    },
  );
}
