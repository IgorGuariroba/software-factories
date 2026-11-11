import { describe, expect, it, vi } from "vitest";
import {
  createApiLocal,
  criarRotasApi,
  type FactoryCommands,
  type Pedido,
  type Resposta,
} from "../src/packages/api-local/index.js";

// Adaptador com comandos falsos: as rotas de configuração de publicações (retrô) e do Telegram só traduzem método,
// caminho e Content-Type. As regras (estado, credencial, configuração em andamento) ficam nos comandos.

const HOSTS = new Set(["localhost:7420"]);
const ok = () => vi.fn(async () => ({ status: 200, body: { ok: true } }));

function comandosFalsos() {
  return {
    retroConfiguracao: vi.fn(async () => ({ status: 200, body: { repo: null, available: false } })),
    salvarRetroConfiguracao: ok(),
    telegramConfiguracao: ok(),
    salvarTelegramConfiguracao: ok(),
  } as unknown as FactoryCommands & Record<string, ReturnType<typeof vi.fn>>;
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

describe("configuração de publicações (retrô)", () => {
  it("GET devolve o que o comando diz, sem corpo", async () => {
    const comandos = comandosFalsos();
    const r = await api(comandos).tratar(pedido("GET", "/settings/retro"));
    expect(comandos.retroConfiguracao).toHaveBeenCalledOnce();
    expect(r).toEqual({ status: 200, body: { repo: null, available: false } });
  });

  it("POST sem JSON é 415 e o comando não é chamado", async () => {
    const comandos = comandosFalsos();
    const r = await api(comandos).tratar(pedido("POST", "/settings/retro", { repo: "a/b" }, "text/plain"));
    expect((r as Resposta | undefined)?.status).toBe(415);
    expect(comandos.salvarRetroConfiguracao).not.toHaveBeenCalled();
  });

  it("POST com JSON entrega o corpo ao comando", async () => {
    const comandos = comandosFalsos();
    await api(comandos).tratar(pedido("POST", "/settings/retro", { repo: "usuario/fabrica" }, JSON_CT));
    expect(comandos.salvarRetroConfiguracao).toHaveBeenCalledWith({ repo: "usuario/fabrica" });
  });
});

describe("configuração do Telegram", () => {
  it("GET pede a configuração ao comando", async () => {
    const comandos = comandosFalsos();
    await api(comandos).tratar(pedido("GET", "/telegram/configuracao"));
    expect(comandos.telegramConfiguracao).toHaveBeenCalledOnce();
  });

  it("PUT sem JSON é 415; com JSON, o corpo vai ao comando", async () => {
    const comandos = comandosFalsos();
    const a = api(comandos);
    expect(
      ((await a.tratar(pedido("PUT", "/telegram/configuracao", { chat: "1" }, "text/plain"))) as Resposta | undefined)
        ?.status,
    ).toBe(415);
    expect(comandos.salvarTelegramConfiguracao).not.toHaveBeenCalled();
    await a.tratar(pedido("PUT", "/telegram/configuracao", { chat: "1", usuario: "2" }, JSON_CT));
    expect(comandos.salvarTelegramConfiguracao).toHaveBeenCalledWith({ chat: "1", usuario: "2" });
  });
});
