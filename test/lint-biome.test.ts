import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { criarNotificadorDoProjeto } from "../src/destinatarios-projeto.js";
import type { TeamsNotifier } from "../src/teams-mcp.js";

const raiz = fileURLToPath(new URL("../", import.meta.url));

describe("qualidade do diff: Biome e bloqueio de destinatários", { timeout: 35_000 }, () => {
  it("npm run lint passa com formatação, imports organizados e sem warnings", () => {
    // Usa o script real e a configuração do repositório (incluindo lineWidth 120
    // e noUnsafeFinally). Sem --write, sem shell e sem alterar os arquivos.
    const resultado = spawnSync("npm", ["run", "lint", "--", "--error-on-warnings"], {
      cwd: raiz,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
    });
    const diagnostico = [resultado.error?.message, resultado.stdout, resultado.stderr].filter(Boolean).join("\n");

    expect(resultado.error, diagnostico).toBeUndefined();
    expect(resultado.signal, diagnostico).toBeNull();
    expect(resultado.status, diagnostico).toBe(0);
  });

  it("aguarda o aviso antes de rejeitar o bloqueio e nunca chama o transporte", async () => {
    const ordem: string[] = [];
    let liberarAviso = () => {};
    const avisoPendente = new Promise<void>((resolve) => {
      liberarAviso = resolve;
    });
    const enviar = vi.fn<TeamsNotifier["send"]>().mockResolvedValue(undefined);
    const avisar = vi.fn(async () => {
      ordem.push("aviso-iniciado");
      await avisoPendente;
      ordem.push("aviso-concluido");
    });
    const protegido = criarNotificadorDoProjeto({
      destinatariosPermitidos: ["pessoa-do-projeto"],
      notificador: { send: enviar },
      avisar,
    });
    const resultado = protegido.send({ userId: "pessoa-externa", text: "Pergunta confidencial" }).catch((erro) => {
      ordem.push("rejeitado");
      return erro as Error;
    });

    try {
      await Promise.resolve();
      expect(ordem).toEqual(["aviso-iniciado"]);
      expect(enviar).not.toHaveBeenCalled();
    } finally {
      liberarAviso();
    }
    const erro = await resultado;

    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toMatch(/bloquead/i);
    expect(ordem).toEqual(["aviso-iniciado", "aviso-concluido", "rejeitado"]);
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("falha do aviso não libera o envio nem substitui a rejeição explícita do guardrail", async () => {
    const enviar = vi.fn<TeamsNotifier["send"]>().mockResolvedValue(undefined);
    const avisar = vi.fn(async () => {
      throw new Error("canal interno indisponível");
    });
    const protegido = criarNotificadorDoProjeto({
      destinatariosPermitidos: ["pessoa-do-projeto"],
      notificador: { send: enviar },
      avisar,
    });

    const tentativa = protegido.send({ userId: "pessoa-externa", text: "Pergunta confidencial" });
    await expect(tentativa).rejects.toThrow(/bloquead/i);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(enviar).not.toHaveBeenCalled();
  });
});
