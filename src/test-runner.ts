import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Uma execução do comando de teste de um repositório. */
export interface TestRun {
  /** Código de saída; `null` se o processo foi morto por sinal (ex.: estouro do tempo). */
  exitCode: number | null;
  timedOut: boolean;
  /** Fim da saída (stdout e stderr intercalados), no máximo `MAX_TEST_OUTPUT` caracteres. */
  output: string;
  /** O comando nem chegou a rodar (ex.: programa inexistente). */
  spawnError?: string;
}

export interface TestRunRequest {
  /** Clone da fábrica onde os testes rodam. */
  cwd: string;
  /** argv fixo da config: nunca passa por um shell e o modelo não acrescenta nada. */
  command: readonly string[];
  timeoutMs: number;
  /** Cancela a execução: o processo é morto e `run` rejeita. */
  signal?: AbortSignal;
}

/**
 * Quem executa o comando de teste: a fábrica (para verificar o TDD) e a ferramenta `rodar_testes` do modelo.
 * É aqui que o sandbox `bubblewrap` (M1-12) envolve o processo, sem mudar quem chama.
 */
export interface TestRunner {
  run(request: TestRunRequest): Promise<TestRun>;
}

export const MAX_TEST_OUTPUT = 8_000;

/**
 * Executa o comando direto no host, com o ambiente reduzido ao mínimo: sem as variáveis da fábrica (chaves de API,
 * tokens, `SSH_AUTH_SOCK`) e com um `HOME` vazio e descartável, para o código escrito pelo modelo não achar as
 * credenciais do usuário. Rede e sistema de arquivos ainda não são confinados: isso é do sandbox (M1-12).
 */
export function createHostTestRunner(): TestRunner {
  return {
    async run({ cwd, command, timeoutMs, signal }) {
      const [program, ...args] = command;
      if (!program) return { exitCode: null, timedOut: false, output: "", spawnError: "comando de teste vazio" };
      const home = await mkdtemp(join(tmpdir(), "fabrica-teste-home-"));
      try {
        return await new Promise<TestRun>((resolve) => {
          let output = "";
          const append = (chunk: Buffer) => {
            output = (output + chunk.toString("utf8")).slice(-MAX_TEST_OUTPUT);
          };
          const child = spawn(program, args, {
            cwd,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
              PATH: process.env.PATH ?? "/usr/bin:/bin",
              HOME: home,
              LANG: process.env.LANG ?? "C.UTF-8",
              TMPDIR: home,
              CI: "1",
            },
          });
          let timedOut = false;
          // `detached` põe o comando num grupo de processos próprio: matar o grupo leva junto o que ele criou.
          const killGroup = () => {
            try {
              if (child.pid) process.kill(-child.pid, "SIGKILL");
            } catch {
              // O grupo já terminou.
            }
          };
          const timer = setTimeout(() => {
            timedOut = true;
            killGroup();
          }, timeoutMs);
          signal?.addEventListener("abort", killGroup, { once: true });
          child.stdout.on("data", append);
          child.stderr.on("data", append);
          child.on("error", (err) => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", killGroup);
            resolve({ exitCode: null, timedOut: false, output, spawnError: err.message });
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", killGroup);
            resolve({ exitCode: code, timedOut, output });
          });
        }).then((run) => {
          // Um processo morto pelo cancelamento não é um resultado de teste: quem pediu não pode tomá-lo como falha.
          signal?.throwIfAborted();
          return run;
        });
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  };
}
