import { numeroDaChave } from "../../fonte-demanda/index.js";

/** Estados do card em que ele pode virar Tarefa agora. Fonte única da regra, usada também pelo webhook do GitHub. */
const ELEGIVEIS: ReadonlySet<string> = new Set(["todo", "in_progress"]);

/** O estado do card permite virar Tarefa agora? */
export function estadoElegivel(estado: string): boolean {
  return ELEGIVEIS.has(estado);
}

/** Card de uma Fonte, como a busca o enxerga. */
export interface CardBusca {
  key: string;
  title: string;
  status: string;
  assignee: string;
}

/** Projeto como a busca o enxerga: o responsável, o mapa de estados e a lista de cards que ele acompanha. */
export interface ProjetoBusca {
  nome: string;
  /** Repositório monitorado (GitHub): as issues mais antigas vêm primeiro. */
  github: boolean;
  assignee: string;
  statuses: Record<string, string | undefined>;
  keys?: string[];
  listarAtribuidos(assignee: string): Promise<CardBusca[]>;
}

/** Card elegível: pronto para virar Tarefa. */
export interface ItemBusca {
  project: string;
  key: string;
  title: string;
  status: string;
  state: string;
}

/** Dependências da busca. `estado` é opaco aqui: a fábrica o interpreta nas regras de pausa e de repositório. */
export interface PortasBusca {
  projetos(): ProjetoBusca[];
  estado(): Promise<unknown>;
  repoDesativado(estado: unknown, projeto: string): boolean;
  projetoPausado(estado: unknown, projeto: string): boolean;
  pendenciasBloqueantes(projeto: string, estado: unknown): string[];
}

/** Número da issue na chave `<projeto>-<n>`, para ordenar das mais antigas para as mais novas. */
const ordemDaIssue = (key: string): number => numeroDaChave(key) || 0;

/**
 * Cards elegíveis na Fonte agora. Um repositório desativado, um projeto pausado ou incompleto não entra na busca: nenhuma
 * Tarefa nova dele (ADR-0015, ADR-0022, ticket 09). Só entram os cards atribuídos ao responsável, em estado elegível e
 * dentro das chaves do projeto, se ele as limita.
 */
export async function cardsElegiveis(portas: PortasBusca): Promise<ItemBusca[]> {
  const itens: ItemBusca[] = [];
  const estado = await portas.estado();
  for (const projeto of portas.projetos()) {
    if (portas.repoDesativado(estado, projeto.nome)) continue;
    if (portas.projetoPausado(estado, projeto.nome)) continue;
    if (portas.pendenciasBloqueantes(projeto.nome, estado).length > 0) continue;
    const cards = await projeto.listarAtribuidos(projeto.assignee);
    if (projeto.github) cards.sort((a, b) => ordemDaIssue(a.key) - ordemDaIssue(b.key));
    for (const card of cards) {
      const state = projeto.statuses[card.status];
      if (card.assignee !== projeto.assignee || !state || !estadoElegivel(state)) continue;
      if (projeto.keys && !projeto.keys.includes(card.key)) continue;
      itens.push({ project: projeto.nome, key: card.key, title: card.title, status: card.status, state });
    }
  }
  return itens;
}

/** Dependências completas da busca: as de elegibilidade, mais a sincronização, as perguntas e a fila. */
export interface PortasBuscaCompleta extends PortasBusca {
  /** Sincronização dos repositórios (reconciliação com o GitHub). Uma falha não impede a busca dos cards. */
  sincronizarRepositorios(): Promise<void>;
  registrarErroSincronizacao(erro: unknown): void;
  /** Confere as respostas esperadas pelo Canal. */
  verificarPerguntas(): Promise<void>;
  /** Grava como Tarefas os cards elegíveis que ainda não viraram Tarefa. */
  enfileirar(itens: ItemBusca[]): Promise<void>;
}

/**
 * Busca na Fonte: sincroniza os repositórios (sem deixar a falha impedir a busca), confere as respostas esperadas e
 * enfileira os cards elegíveis.
 */
export async function buscarNaFonte(portas: PortasBuscaCompleta): Promise<void> {
  try {
    await portas.sincronizarRepositorios();
  } catch (erro) {
    portas.registrarErroSincronizacao(erro);
  }
  await portas.verificarPerguntas();
  await portas.enfileirar(await cardsElegiveis(portas));
}

/**
 * Cards que ainda não viraram Tarefa. Um card já existente (ou repetido no próprio lote) não entra de novo: a Tarefa é
 * identificada por `<projeto>/<chave>`.
 */
export function tarefasNovas(itens: ItemBusca[], existentes: readonly string[]): ItemBusca[] {
  const vistos = new Set(existentes);
  const novas: ItemBusca[] = [];
  for (const item of itens) {
    const id = `${item.project}/${item.key}`;
    if (vistos.has(id)) continue;
    vistos.add(id);
    novas.push(item);
  }
  return novas;
}
