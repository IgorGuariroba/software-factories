import { describe, expect, it, vi } from "vitest";
import { createApiLocal, criarRotasApi, type FactoryCommands, type Pedido } from "../src/packages/api-local/index.js";

// Stream de eventos: o adaptador não escreve na conexão. Devolve uma resposta de fluxo que o servidor liga ao cliente.

const HOSTS = new Set(["localhost:7420"]);
const pedido = (metodo: string, caminho: string, host = "localhost:7420"): Pedido => ({
  metodo,
  caminho,
  host,
  corpo: async () => undefined,
});

describe("stream de eventos", () => {
  it("GET /events/stream devolve uma resposta de fluxo com a assinatura dos comandos", async () => {
    const desligar = vi.fn();
    const assinar = vi.fn(() => desligar);
    const comandos = { eventosFluxo: vi.fn(() => ({ tipo: "fluxo" as const, assinar })) } as unknown as FactoryCommands;
    const api = createApiLocal({ hosts: () => HOSTS, rotas: criarRotasApi(comandos) });

    const r = await api.tratar(pedido("GET", "/events/stream"));

    expect(comandos.eventosFluxo).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ tipo: "fluxo" });
    const enviados: string[] = [];
    const fim = (r as { assinar(enviar: (d: string) => void): () => void }).assinar((d) => enviados.push(d));
    expect(assinar).toHaveBeenCalledOnce();
    expect(fim).toBe(desligar);
  });

  it("o stream também exige host local: um cliente externo recebe 403, não a assinatura", async () => {
    const comandos = { eventosFluxo: vi.fn() } as unknown as FactoryCommands;
    const api = createApiLocal({ hosts: () => HOSTS, rotas: criarRotasApi(comandos) });

    const r = await api.tratar(pedido("GET", "/events/stream", "evil.example:7420"));

    expect(r).toEqual({ status: 403, body: { error: "a API aceita só clientes locais" } });
    expect(comandos.eventosFluxo).not.toHaveBeenCalled();
  });
});
