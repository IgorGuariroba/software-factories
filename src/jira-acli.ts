import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// Execução do acli (CLI da Atlassian): localiza o binário e roda os comandos da Fonte Jira.

const execFileAsync = promisify(execFile);

export interface AcliExecResult {
  stdout: string;
  stderr: string;
  exitCode?: number;
}

/** Runner injetável para comandos do acli. Permite testes sem invocar o binário real. */
export type AcliRunner = (args: string[]) => Promise<AcliExecResult>;

/**
 * Runner padrão que localiza o acli (incluindo ~/.local/bin) e executa o binário.
 */
export const defaultAcliRunner: AcliRunner = async (args: string[]) => {
  const customPath = process.env.ACLI_PATH;
  const acliBin = customPath || "acli";
  const userLocalBin = join(homedir(), ".local", "bin");
  const currentPath = process.env.PATH ?? "";
  const pathWithLocal = currentPath.includes(userLocalBin) ? currentPath : `${userLocalBin}:${currentPath}`;

  try {
    const { stdout, stderr } = await execFileAsync(acliBin, args, {
      maxBuffer: 20 * 1024 * 1024,
      timeout: 120_000,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: pathWithLocal,
      },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr?.trim() || `código ${err.code ?? "desconhecido"}`,
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
};
