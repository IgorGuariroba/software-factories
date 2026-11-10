import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactSecrets } from "./secrets.js";

/**
 * Sandbox do bash dos modelos (ADR-0006): bubblewrap com o sistema inteiro só de leitura, o clone da Tarefa como
 * único lugar gravável, sem rede e com ambiente vazio. Sem o bwrap instalado, nada roda: a fábrica não cai num
 * shell direto.
 */

export const MAX_SANDBOX_OUTPUT = 8_000;

export interface ResultadoSandbox {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

/** O bwrap está instalado e roda neste host (usuários sem namespaces não o têm). */
export function sandboxDisponivel(): boolean {
  try {
    execFileSync("bwrap", ["--ro-bind", "/", "/", "true"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Argumentos do bwrap para um comando dentro do clone e de um HOME descartável. */
export function argumentosDoSandbox(clone: string, home: string): string[] {
  return [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--bind",
    home,
    home,
    "--bind",
    clone,
    clone,
    "--chdir",
    clone,
    "--unshare-net",
    "--unshare-ipc",
    "--unshare-uts",
    "--new-session",
    "--die-with-parent",
    "--clearenv",
    "--setenv",
    "PATH",
    "/usr/local/bin:/usr/bin:/bin",
    "--setenv",
    "HOME",
    home,
    "--setenv",
    "LANG",
    "C.UTF-8",
  ];
}

/** Roda `comando` no sandbox, com o clone como diretório atual. O tempo limite mata o grupo inteiro de processos. */
export async function executarNoSandbox(opts: {
  cwd: string;
  comando: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ResultadoSandbox> {
  const home = await mkdtemp(join(tmpdir(), "fabrica-sandbox-home-"));
  try {
    return await new Promise<ResultadoSandbox>((resolve) => {
      let output = "";
      const append = (chunk: Buffer) => {
        output = (output + chunk.toString("utf8")).slice(-MAX_SANDBOX_OUTPUT);
      };
      const child = spawn("bwrap", [...argumentosDoSandbox(opts.cwd, home), "--", "/bin/sh", "-c", opts.comando], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      let timedOut = false;
      const matar = () => {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            /* o grupo já terminou */
          }
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        matar();
      }, opts.timeoutMs);
      opts.signal?.addEventListener("abort", matar, { once: true });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ exitCode: null, timedOut: false, output: redactSecrets(`bwrap: ${err.message}`) });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code, timedOut, output: redactSecrets(output) });
      });
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
