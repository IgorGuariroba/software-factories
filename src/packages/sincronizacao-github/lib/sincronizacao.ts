/** Janela de sobreposição da consulta de alterações: cobre edições feitas enquanto a própria consulta rodava. */
export const JANELA_DE_SOBREPOSICAO_MS = 60_000;

/** Quantas entregas do webhook a fábrica lembra, para reconhecer reenvios. */
export const MEMORIA_DE_ENTREGAS = 1000;

/** Parte do estado que a sincronização lê e grava. Formato estrutural: o estado da fábrica o satisfaz. */
export interface EstadoSincronizacao {
  sincronizadoEm?: Record<string, string>;
  deliveries?: string[];
  ultimoWebhookEm?: string;
}

/** Projeto de repositório monitorado que pode ser reconciliado. */
export interface ProjetoSincronizavel<Snapshot, Configuracao> {
  nome: string;
  configuracao: Configuracao;
  /** Consulta o que mudou no repositório desde a data dada (ISO 8601). */
  listarMudancasDesde(desde: string): Promise<Snapshot[]>;
}

/** Entrega do GitHub (issue ou instalação do App), identificada pelo `X-GitHub-Delivery`. */
export interface EntregaComId {
  deliveryId: string;
}

/** Dependências da sincronização com o GitHub. Tipos de entrega, snapshot e efeito são opacos aqui. */
export interface PortasSincronizacao<Snapshot, Configuracao, Entrega, Efeito> {
  agora(): number;
  projetos(): ProjetoSincronizavel<Snapshot, Configuracao>[];
  estado(): Promise<EstadoSincronizacao>;
  /** Altera o estado numa transação durável. */
  alterar<T>(fn: (estado: EstadoSincronizacao) => T): Promise<T>;
  repoDesativado(estado: EstadoSincronizacao, projeto: string): boolean;
  /** Entregas que a reconciliação encontrou e o webhook não entregou. */
  reconciliar(
    estado: EstadoSincronizacao,
    projeto: ProjetoSincronizavel<Snapshot, Configuracao>,
    snapshots: Snapshot[],
  ): Entrega[];
  /** Aplica uma entrega ao estado da transação e devolve os efeitos a executar depois da gravação. */
  aplicar(estado: EstadoSincronizacao, entrega: Entrega): Efeito[];
  executarEfeitos(efeitos: Efeito[]): Promise<void>;
}

/**
 * Reconciliação (ADR-0015): para cada repositório ativo, consulta o que mudou desde a última sincronização, com uma janela
 * de sobreposição, e aplica o que o webhook não entregou. Sem sincronização anterior, só grava a linha de base: a busca
 * cuida dos cards abertos.
 */
export async function reconciliar<Snapshot, Configuracao, Entrega extends EntregaComId, Efeito>(
  portas: PortasSincronizacao<Snapshot, Configuracao, Entrega, Efeito>,
): Promise<void> {
  const iniciadaEm = new Date(portas.agora()).toISOString();
  for (const projeto of portas.projetos()) {
    const estado = await portas.estado();
    if (portas.repoDesativado(estado, projeto.nome)) continue;
    const desde = estado.sincronizadoEm?.[projeto.nome];
    if (desde !== undefined) {
      const snapshots = await projeto.listarMudancasDesde(
        new Date(Date.parse(desde) - JANELA_DE_SOBREPOSICAO_MS).toISOString(),
      );
      for (const entrega of portas.reconciliar(estado, projeto, snapshots)) await aplicarEntrega(portas, entrega);
    }
    await portas.alterar((atual) => {
      atual.sincronizadoEm = { ...atual.sincronizadoEm, [projeto.nome]: iniciadaEm };
    });
  }
}

/**
 * Aplica uma entrega ao estado e executa os efeitos. Um reenvio de entrega já aplicada não muda nada e não gera efeitos.
 * A memória de entregas é limitada: só as mais recentes contam.
 */
export async function aplicarEntrega<Snapshot, Configuracao, Entrega extends EntregaComId, Efeito>(
  portas: PortasSincronizacao<Snapshot, Configuracao, Entrega, Efeito>,
  entrega: Entrega,
): Promise<void> {
  let efeitos: Efeito[] = [];
  let duplicada = false;
  await portas.alterar((estado) => {
    if (estado.deliveries?.includes(entrega.deliveryId)) {
      duplicada = true;
      return;
    }
    efeitos = portas.aplicar(estado, entrega);
    estado.deliveries = [...(estado.deliveries ?? []), entrega.deliveryId].slice(-MEMORIA_DE_ENTREGAS);
    estado.ultimoWebhookEm = new Date(portas.agora()).toISOString();
  });
  if (!duplicada) await portas.executarEfeitos(efeitos);
}
