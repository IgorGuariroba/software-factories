// Entry point público do adaptador HTTP da API local. Traduz pedidos em respostas; não guarda regra de negócio.

import { despachar, type Pedido, type RespostaApi, type Rota } from "./lib/despacho.js";
import { ehClienteLocal } from "./lib/guardas.js";

export type { FactoryCommands, VetoResult } from "./lib/comandos.js";
export type { Pedido, Resposta, RespostaApi, RespostaFluxo, Rota } from "./lib/despacho.js";
export { ehClienteLocal, ehJson, type PedidoLocal } from "./lib/guardas.js";
export { criarRotasApi, rotasDocumentadas } from "./lib/rotas.js";

export interface ApiLocal {
  /** Trata um pedido. `undefined` quando nenhuma rota do adaptador casa, para o chamador tratar (arquivo ou 404). */
  tratar(pedido: Pedido): Promise<RespostaApi | undefined>;
}

export function createApiLocal(opts: { rotas: readonly Rota[]; hosts: () => ReadonlySet<string> }): ApiLocal {
  return {
    async tratar(pedido) {
      if (!ehClienteLocal(pedido, opts.hosts()))
        return { status: 403, body: { error: "a API aceita só clientes locais" } };
      return despachar(opts.rotas, pedido);
    },
  };
}
