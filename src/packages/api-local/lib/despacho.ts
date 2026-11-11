/** Resposta de uma rota: o código HTTP e o corpo JSON. */
export interface Resposta {
  status: number;
  body: unknown;
}

/** Um pedido já lido pelo servidor: o caminho sem query, e o corpo lido sob demanda. */
/**
 * Resposta de fluxo (stream): o adaptador não escreve na conexão. O servidor escreve os cabeçalhos, chama `assinar`
 * com a função que envia cada evento e guarda a função que desliga; `assinar` devolve essa função.
 */
export interface RespostaFluxo {
  tipo: "fluxo";
  assinar(enviar: (dados: string) => void): () => void;
}

export type RespostaApi = Resposta | RespostaFluxo;

export interface Pedido {
  metodo: string;
  caminho: string;
  host?: string;
  origem?: string;
  contentType?: string;
  corpo(): Promise<unknown>;
}

export interface Rota {
  metodo: "GET" | "POST" | "PUT" | "DELETE";
  /** Caminho exato, ou expressão sobre o caminho cujas capturas o manipulador recebe. */
  caminho: string | RegExp;
  /** Caminho no formato do OpenAPI (`/tasks/{project}/{key}`), que tem de existir no schema. */
  documentada: string;
  manipular(pedido: Pedido, capturas: string[]): Promise<RespostaApi>;
}

/** Primeira rota que casa com o método e o caminho. `undefined` quando nenhuma casa. */
export async function despachar(rotas: readonly Rota[], pedido: Pedido): Promise<RespostaApi | undefined> {
  for (const rota of rotas) {
    if (rota.metodo !== pedido.metodo) continue;
    if (typeof rota.caminho === "string") {
      if (rota.caminho === pedido.caminho) return rota.manipular(pedido, []);
      continue;
    }
    const casou = pedido.caminho.match(rota.caminho);
    if (casou)
      return rota.manipular(
        pedido,
        casou.slice(1).map((c) => c ?? ""),
      );
  }
  return undefined;
}
