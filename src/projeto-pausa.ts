/**
 * O projeto está pausado pelo usuário (ticket 09). Pausar é como pausar o daemon, só que por projeto: nenhuma Tarefa
 * nova começa, a busca na Fonte não enfileira nada, e a Tarefa em andamento para no próximo passo.
 */
export const projetoPausado = (state: { projetosPausados?: string[] }, project: string): boolean =>
  state.projetosPausados?.includes(project) === true;
