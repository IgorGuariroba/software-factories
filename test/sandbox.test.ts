import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executarNoSandbox, sandboxDisponivel } from "../src/sandbox.js";

const disponivel = sandboxDisponivel();

let raiz: string;
let clone: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "fabrica-sandbox-"));
  clone = join(raiz, "clone");
  await mkdir(clone);
});
afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe.skipIf(!disponivel)("sandbox do bash dos modelos (ADR-0006)", () => {
  it("executa o comando dentro do clone e devolve a saída", async () => {
    const r = await executarNoSandbox({ cwd: clone, comando: "echo ola", timeoutMs: 10_000 });
    expect(r.exitCode).toBe(0);
    expect(r.output.trim()).toBe("ola");
  });

  it("escreve dentro do clone", async () => {
    const r = await executarNoSandbox({ cwd: clone, comando: "echo x > dentro.txt", timeoutMs: 10_000 });
    expect(r.exitCode).toBe(0);
    expect(execFileSync("cat", [join(clone, "dentro.txt")], { encoding: "utf8" }).trim()).toBe("x");
  });

  it("não escreve fora do clone", async () => {
    // /etc é do host e fica só de leitura; /tmp dentro do sandbox é um tmpfs próprio e não conta como fora.
    const fora = "/etc/fabrica-sandbox-teste";
    const r = await executarNoSandbox({ cwd: clone, comando: `echo x > ${fora}`, timeoutMs: 10_000 });
    expect(r.exitCode).not.toBe(0);
    expect(() => execFileSync("test", ["-e", fora])).toThrow();
  });

  it("não tem rede: só a interface de loopback existe no namespace", async () => {
    // /proc/net segue o namespace de rede do processo; /sys/class/net mostra as interfaces do host.
    const r = await executarNoSandbox({
      cwd: clone,
      comando: "tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d ' '",
      timeoutMs: 10_000,
    });
    expect(r.output.trim().split(/\s+/)).toEqual(["lo"]);
  });

  it("não herda o ambiente da fábrica (sem segredos nas variáveis)", async () => {
    process.env.FABRICA_SEGREDO_TESTE = "nao-pode-vazar";
    try {
      const r = await executarNoSandbox({ cwd: clone, comando: "env", timeoutMs: 10_000 });
      expect(r.output).not.toContain("nao-pode-vazar");
    } finally {
      delete process.env.FABRICA_SEGREDO_TESTE;
    }
  });

  it("mata o comando que passa do tempo limite", async () => {
    const r = await executarNoSandbox({ cwd: clone, comando: "sleep 30", timeoutMs: 500 });
    expect(r.timedOut).toBe(true);
  }, 20_000);
});
