import type { FactoryState, QueuedTask, RepoBinding } from "./durable.js";
import type { WebhookEffect } from "./github-webhook.js";

/** Estados terminais: a Tarefa já não mexe no card nem no repositório. */
const TERMINAL: ReadonlySet<string> = new Set(["concluida", "cancelada", "bloqueada", "vetada", "recusada"]);

/** Tarefas do projeto ainda não terminadas (enfileiradas, em execução ou paradas): bloqueiam a troca de Fonte. */
export const tarefasEmAndamento = (state: Pick<FactoryState, "tasks">, project: string): QueuedTask[] =>
  state.tasks.filter((t) => t.project === project && !TERMINAL.has(t.status));

/** O repositório do projeto está desativado: nada novo entra na fila dele (ADR-0015). */
export const repoDesativado = (state: Pick<FactoryState, "repos">, project: string): boolean =>
  state.repos?.[project]?.status === "desativado";

/** Tarefas não terminadas do projeto que estão executando agora. */
export const tarefasAtivas = (state: Pick<FactoryState, "tasks">, project: string): QueuedTask[] =>
  state.tasks.filter((t) => t.project === project && t.status === "ativa");

/**
 * Desativa o repositório de um projeto. Tarefas não ativas e não terminadas são canceladas (com a parada da execução
 * durável, se houver). Uma Tarefa ativa só é cancelada com `force`; sem ele, é pausada e devolvida em `ativas` para a
 * confirmação de quem comanda.
 */
export function desativarProjeto(opts: {
  state: FactoryState;
  project: string;
  repo: string;
  motivo: string;
  force: boolean;
}): { effects: WebhookEffect[]; ativas: string[] } {
  const { state, project, repo, motivo, force } = opts;
  const effects: WebhookEffect[] = [];
  const ativas: string[] = [];
  for (const task of state.tasks) {
    if (task.project !== project || TERMINAL.has(task.status)) continue;
    if (task.status === "ativa" && !force) {
      task.pauseRequested = true;
      ativas.push(task.id);
      continue;
    }
    task.reason = motivo;
    if (task.durableId !== null) effects.push({ type: "abortar", id: task.id });
    else task.status = "cancelada";
  }
  const previous = state.repos?.[project];
  state.repos = {
    ...state.repos,
    [project]: {
      repo,
      status: "desativado",
      motivo,
      ...(previous?.installationId !== undefined ? { installationId: previous.installationId } : {}),
      // O id do repositório sobrevive ao desplugue: replugar não perde a identidade (ADR-0015, Fase 4).
      ...(previous?.repoId !== undefined ? { repoId: previous.repoId } : {}),
    },
  };
  return { effects, ativas };
}

/** Reativa o repositório de um projeto. Não cria Tarefas: a próxima busca na Fonte é que enfileira os cards. */
export function ativarProjeto(opts: {
  state: FactoryState;
  project: string;
  repo: string;
  installationId?: number;
}): void {
  const { state, project, repo, installationId } = opts;
  const previous = state.repos?.[project];
  const id = installationId ?? previous?.installationId;
  const binding: RepoBinding = {
    repo,
    status: "ativo",
    ...(id !== undefined ? { installationId: id } : {}),
    ...(previous?.repoId !== undefined ? { repoId: previous.repoId } : {}),
  };
  state.repos = { ...state.repos, [project]: binding };
}
