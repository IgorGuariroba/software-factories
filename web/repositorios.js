// Apresentação pura dos repositórios monitorados: sem DOM, para testar em Node (test/web-repositorios.test.ts).

/**
 * Uma linha da lista de repositórios, já com o texto e a ação que a tela mostra.
 * @param {{ project: string, repo: string, status: "ativo" | "desativado", installationId: number | null, motivo: string | null }[]} repos
 */
export function linhasRepositorios(repos) {
  return repos.map((r) => {
    const ativo = r.status === "ativo";
    return {
      projeto: r.project,
      repositorio: r.repo,
      estado: ativo ? "Ativo" : "Desativado",
      acao: ativo ? "desplugar" : "plugar",
      motivo: ativo ? "" : (r.motivo ?? ""),
      origem: r.installationId === null ? "configurado no YAML" : `instalação ${r.installationId}`,
    };
  });
}

/**
 * Aviso mostrado antes de desplugar quando há Tarefa em execução. Desplugar com `force` cancela essas Tarefas.
 * @param {string[]} tarefas identificadores `projeto/card`
 */
export function mensagemTarefasAtivas(tarefas) {
  const plural = tarefas.length > 1;
  const quantidade = plural ? `${tarefas.length} Tarefas` : "1 Tarefa";
  const verbo = plural ? "estão em execução" : "está em execução";
  return `${quantidade} ${verbo} neste repositório: ${tarefas.join(", ")}. Desplugar agora cancela ${plural ? "essas Tarefas" : "essa Tarefa"}.`;
}
