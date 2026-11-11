import { describe, expect, it, vi } from "vitest";
import { criarCredenciais, type PortasCredenciais } from "../src/packages/credenciais/index.js";

// Troca de credencial com portas falsas: fixa a validação do valor, o teste de conexão do Jira antes de trocar, o
// histórico por projeto e o reinício do Telegram. Sem cofre real, sem Jira, sem fábrica.

function portasFalsas(sobrescritas: Partial<PortasCredenciais> = {}) {
  const guardados: [string, string][] = [];
  const reinicios = vi.fn(async () => undefined);
  const historicos: { projetos: string[]; nome: string }[] = [];
  const portas: PortasCredenciais = {
    projetos: async () => [],
    testarConexaoJira: async () => ({ ok: true }),
    guardar: async (nome, valor) => {
      guardados.push([nome, valor]);
      return { nome };
    },
    telegramUsa: async () => false,
    reiniciarTelegram: reinicios,
    registrarTroca: async (projetos, nome) => {
      historicos.push({ projetos, nome });
    },
    ...sobrescritas,
  };
  return { credenciais: criarCredenciais(portas), guardados, reinicios, historicos, portas };
}

const jira = { nome: "projeto-a", fonte: { type: "jira", baseUrl: "https://j.exemplo", email: "ana@x" } };

describe("Credenciais: troca", () => {
  it("valor ausente ou vazio responde 400 e não grava", async () => {
    const { credenciais, guardados } = portasFalsas();
    expect((await credenciais.gravar("jira", {})).status).toBe(400);
    expect((await credenciais.gravar("jira", { valor: "" })).status).toBe(400);
    expect(guardados).toEqual([]);
  });

  it("credencial sem projetos que a usem: grava sem testar nem registrar histórico", async () => {
    const testar = vi.fn(async () => ({ ok: true as const }));
    const { credenciais, guardados, historicos } = portasFalsas({ testarConexaoJira: testar });
    const r = await credenciais.gravar("outra", { valor: "segredo" });
    expect(r).toEqual({ status: 200, body: { nome: "outra" } });
    expect(guardados).toEqual([["outra", "segredo"]]);
    expect(testar).not.toHaveBeenCalled();
    expect(historicos).toEqual([]);
  });

  it("Jira que recusa a conexão bloqueia a troca com o motivo, sem gravar", async () => {
    const testar = vi.fn(async () => ({ ok: false as const, motivo: "401" }));
    const { credenciais, guardados } = portasFalsas({
      projetos: async () => [{ ...jira, credencial: "jira" }],
      testarConexaoJira: testar,
    });
    const r = await credenciais.gravar("jira", { valor: "errado" });
    expect(r).toEqual({
      status: 400,
      body: { error: "conexão com o Jira falhou (401); a credencial jira não foi trocada" },
    });
    expect(testar).toHaveBeenCalledWith({ baseUrl: "https://j.exemplo", email: "ana@x" }, "errado");
    expect(guardados).toEqual([]);
  });

  it("conexão ok grava e registra a troca no histórico de cada projeto que a usa", async () => {
    const { credenciais, guardados, historicos } = portasFalsas({
      projetos: async () => [
        { ...jira, credencial: "jira" },
        { nome: "projeto-b", credencial: "jira", fonte: { type: "github" } },
      ],
    });
    await credenciais.gravar("jira", { valor: "novo" });
    expect(guardados).toEqual([["jira", "novo"]]);
    expect(historicos).toEqual([{ projetos: ["projeto-a", "projeto-b"], nome: "jira" }]);
  });

  it("Fonte que não é Jira não passa pelo teste de conexão, mas entra no histórico", async () => {
    const testar = vi.fn(async () => ({ ok: true as const }));
    const { credenciais, historicos } = portasFalsas({
      projetos: async () => [{ nome: "gh", credencial: "gh", fonte: { type: "github" } }],
      testarConexaoJira: testar,
    });
    await credenciais.gravar("gh", { valor: "x" });
    expect(testar).not.toHaveBeenCalled();
    expect(historicos).toEqual([{ projetos: ["gh"], nome: "gh" }]);
  });

  it("se o Telegram usa a credencial, reinicia a interface depois de gravar", async () => {
    const { credenciais, reinicios } = portasFalsas({ telegramUsa: async () => true });
    await credenciais.gravar("telegram", { valor: "t" });
    expect(reinicios).toHaveBeenCalledTimes(1);
  });

  it("projeto que usa outra credencial fica fora do histórico desta troca", async () => {
    const { credenciais, historicos } = portasFalsas({
      projetos: async () => [
        { nome: "a", credencial: "jira", fonte: { type: "github" } },
        { nome: "b", credencial: "outra", fonte: { type: "github" } },
      ],
    });
    await credenciais.gravar("jira", { valor: "novo" });
    expect(historicos).toEqual([{ projetos: ["a"], nome: "jira" }]);
  });
});
