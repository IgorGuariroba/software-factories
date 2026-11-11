import { describe, expect, it, vi } from "vitest";
import {
  createApiLocal,
  criarRotasApi,
  type FactoryCommands,
  type Pedido,
  type Resposta,
} from "../src/packages/api-local/index.js";

// Adaptador com comandos falsos: fixa o caminho, o método, o Content-Type e os campos de transporte das rotas de
// projeto e de segredos. As regras (estado, validação de configuração) ficam nos comandos da fábrica.

const HOSTS = new Set(["localhost:7420"]);
const ok = () => vi.fn(async () => ({ status: 200, body: { ok: true } }));

function comandosFalsos() {
  const base: Record<string, unknown> = {
    pendenciasProjeto: ok(),
    estadoProjeto: ok(),
    confirmarFonteProjeto: ok(),
    historicoProjeto: ok(),
    configuracaoProjeto: ok(),
    salvarConfiguracaoProjeto: ok(),
    listarSegredos: vi.fn(async () => [{ nome: "jira-token" }]),
    gravarSegredo: ok(),
  };
  return base as unknown as FactoryCommands & Record<string, ReturnType<typeof vi.fn>>;
}

const api = (comandos: FactoryCommands) => createApiLocal({ hosts: () => HOSTS, rotas: criarRotasApi(comandos) });

const pedido = (metodo: string, caminho: string, corpo?: unknown, contentType?: string): Pedido => ({
  metodo,
  caminho,
  host: "localhost:7420",
  contentType,
  corpo: async () => corpo,
});

const JSON_CT = "application/json";

describe("rotas de projeto: leitura e confirmação", () => {
  it("GET pendências, estado, histórico e configuração pedem o projeto decodificado ao comando certo", async () => {
    const comandos = comandosFalsos();
    const a = api(comandos);
    await a.tratar(pedido("GET", "/projetos/meu%2Dprojeto/pendencias"));
    await a.tratar(pedido("GET", "/projetos/meu-projeto/estado"));
    await a.tratar(pedido("GET", "/projetos/meu-projeto/historico"));
    await a.tratar(pedido("GET", "/projetos/meu-projeto/configuracao"));
    expect(comandos.pendenciasProjeto).toHaveBeenCalledWith("meu-projeto");
    expect(comandos.estadoProjeto).toHaveBeenCalledWith("meu-projeto");
    expect(comandos.historicoProjeto).toHaveBeenCalledWith("meu-projeto");
    expect(comandos.configuracaoProjeto).toHaveBeenCalledWith("meu-projeto");
  });

  it("confirmação da Fonte é POST: o GET no mesmo caminho não casa", async () => {
    const comandos = comandosFalsos();
    const a = api(comandos);
    expect(await a.tratar(pedido("GET", "/projetos/p/confirmacao"))).toBeUndefined();
    await a.tratar(pedido("POST", "/projetos/p/confirmacao"));
    expect(comandos.confirmarFonteProjeto).toHaveBeenCalledWith("p");
  });
});

describe("rotas de projeto: alterar configuração", () => {
  it("PUT sem JSON é 415 e o comando não é chamado", async () => {
    const comandos = comandosFalsos();
    const r = await api(comandos).tratar(pedido("PUT", "/projetos/p/configuracao", { name: "p" }, "text/plain"));
    expect(r).toEqual({ status: 415, body: { error: "envie Content-Type: application/json" } });
    expect(comandos.salvarConfiguracaoProjeto).not.toHaveBeenCalled();
  });

  it("PUT com JSON entrega o corpo inteiro ao comando, que valida o schema e o estado", async () => {
    const comandos = comandosFalsos();
    const corpo = { name: "p", source: { type: "gitlab" } };
    await api(comandos).tratar(pedido("PUT", "/projetos/p/configuracao", corpo, JSON_CT));
    expect(comandos.salvarConfiguracaoProjeto).toHaveBeenCalledWith("p", corpo);
  });
});

describe("rotas de segredos", () => {
  it("GET lista os segredos pelo comando", async () => {
    const comandos = comandosFalsos();
    const r = await api(comandos).tratar(pedido("GET", "/segredos"));
    expect(r).toEqual({ status: 200, body: [{ nome: "jira-token" }] });
  });

  it("PUT com nome fora do padrão é 400 antes de qualquer outra verificação", async () => {
    const comandos = comandosFalsos();
    const r = await api(comandos).tratar(pedido("PUT", "/segredos/A_B", { valor: "x" }, JSON_CT));
    expect(r).toEqual({
      status: 400,
      body: { error: "nome: use minúsculas, números e hífen (2 a 64 caracteres)" },
    });
    expect(comandos.gravarSegredo).not.toHaveBeenCalled();
  });

  it("PUT sem JSON é 415; com JSON, o nome válido e o corpo vão ao comando", async () => {
    const comandos = comandosFalsos();
    const a = api(comandos);
    expect(
      ((await a.tratar(pedido("PUT", "/segredos/jira-token", { valor: "x" }, "text/plain"))) as Resposta | undefined)
        ?.status,
    ).toBe(415);
    await a.tratar(pedido("PUT", "/segredos/jira-token", { valor: "x" }, JSON_CT));
    expect(comandos.gravarSegredo).toHaveBeenCalledWith("jira-token", { valor: "x" });
  });
});
