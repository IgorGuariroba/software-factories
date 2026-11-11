import type { CardState, ProjectConfig } from "./config.js";
import type { IssueSnapshot } from "./demand-source.js";
import type { FactoryState, OrigemGitHub, QueuedTask } from "./durable.js";
import { novaTarefa } from "./estado-fabrica.js";
import { cardOfIssue, labelNames, type RawIssue } from "./github-demand-source.js";
import type { InstallationDelivery, IssueAction, IssueDelivery } from "./github-entrega.js";
import { tarefaDaIssue } from "./github-identidade.js";
import { TERMINAIS } from "./packages/controle-tarefa/index.js";
import { estadoElegivel } from "./packages/escalonador/index.js";
import { temRotuloIgnorado } from "./packages/fonte-demanda/index.js";
import { ativarProjeto, desativarProjeto, repoDesativado } from "./repositorios.js";

export {
  type InstallationAction,
  type InstallationDelivery,
  type IssueAction,
  type IssueDelivery,
  type ParsedDelivery,
  parseGitHubDelivery,
  verifyGitHubSignature,
} from "./github-entrega.js";

// --- Aplicação ao estado durável ------------------------------------------------------------------

/** Efeito que o estado sozinho não executa: a fábrica precisa parar uma execução durável. */
export type WebhookEffect =
  | { type: "abortar"; id: string }
  /** Aviso ao usuário, consolidado pela camada de eventos (um por mudança de escopo). */
  | {
      type: "notificar";
      project: string;
      target: string;
      reason: "escopo-alterado" | "repositorio-desvinculado" | "repo-sem-projeto" | "repositorio-renomeado";
      message: string;
    };

export type WebhookProject = { name: string; config: ProjectConfig };

/** Motivos gravados na Tarefa; a reabertura só devolve à fila o que o próprio fechamento cancelou. */
export const CLOSED_REASON = "issue fechada no GitHub";
export const REMOVED_REASON = "issue removida no GitHub";

/** Estados em que a Tarefa já pode ter sido lida pelo agente: mudança de escopo aqui exige avisar. */
const EXECUTING: ReadonlySet<string> = new Set(["ativa", "aguardando-entrega"]);

/** Descrição e contagem de checkboxes (`- [ ]` / `- [x]`) de uma issue. */
export function scopeOf(body: string | null | undefined): QueuedTask["scope"] {
  const description = body ?? "";
  let done = 0;
  let total = 0;
  for (const m of description.matchAll(/^\s*[-*+]\s+\[([ xX])\]/gm)) {
    total++;
    if (m[1] !== " ") done++;
  }
  return { description, checkboxes: { done, total } };
}

/**
 * Projeto monitorado de uma entrega. Pelo id do repositório quando o vínculo já o conhece (ADR-0015, Fase 4): assim um
 * repositório renomeado continua sendo o mesmo projeto. Sem vínculo, casa pelo nome e grava o id para as próximas.
 */
function projetoDaEntrega(
  state: FactoryState,
  projects: WebhookProject[],
  delivery: IssueDelivery,
): { project: WebhookProject; renomeadoDe?: string } | undefined {
  const githubs = projects.filter((p) => p.config.source.type === "github");
  if (delivery.repoId !== undefined) {
    const porId = githubs.find((p) => state.repos?.[p.name]?.repoId === delivery.repoId);
    if (porId?.config.source.type === "github") {
      const configurado = porId.config.source.repo;
      const renomeadoDe = configurado.toLowerCase() === delivery.repo.toLowerCase() ? undefined : configurado;
      return { project: porId, ...(renomeadoDe ? { renomeadoDe } : {}) };
    }
  }
  const repo = delivery.repo.toLowerCase();
  const porNome = githubs.find((p) => p.config.source.type === "github" && p.config.source.repo.toLowerCase() === repo);
  if (!porNome) return undefined;
  if (delivery.repoId !== undefined) gravarRepoId(state, porNome.name, delivery.repo, delivery.repoId);
  return { project: porNome };
}

/** Grava o id do repositório no vínculo do projeto, sem mudar o status (uma desativação continua desativada). */
export function gravarRepoId(state: FactoryState, project: string, repo: string, repoId: number): void {
  const previo = state.repos?.[project];
  if (previo?.repoId === repoId) return;
  state.repos = {
    ...state.repos,
    [project]: {
      repo: previo?.repo ?? repo,
      status: previo?.status ?? "ativo",
      repoId,
      ...(previo?.installationId !== undefined ? { installationId: previo.installationId } : {}),
      ...(previo?.motivo !== undefined ? { motivo: previo.motivo } : {}),
    },
  };
}

/**
 * Tarefa da issue, pela identidade (Fase 4): primeiro a que já tem a origem; depois a legada, da busca antiga, com a
 * mesma chave e sem origem, que recebe a origem. Uma Tarefa com a mesma chave mas de outra origem não é tocada: a
 * identidade não se mistura.
 */
function tarefaDaEntrega(
  state: FactoryState,
  id: string,
  delivery: IssueDelivery,
): { task: QueuedTask | undefined; outraIdentidade: boolean } {
  if (delivery.repoId !== undefined) {
    const porOrigem = tarefaDaIssue(state.tasks, delivery.repoId, delivery.issue.number);
    if (porOrigem) return { task: porOrigem, outraIdentidade: false };
  }
  const porChave = state.tasks.find((t) => t.id === id);
  if (!porChave) return { task: undefined, outraIdentidade: false };
  if (porChave.origem === undefined && delivery.repoId !== undefined) {
    porChave.origem = origemDaEntrega(delivery);
    return { task: porChave, outraIdentidade: false };
  }
  if (porChave.origem === undefined) return { task: porChave, outraIdentidade: false };
  return { task: undefined, outraIdentidade: true };
}

function origemDaEntrega(delivery: IssueDelivery): OrigemGitHub | undefined {
  if (delivery.repoId === undefined || delivery.issue.id === undefined) return undefined;
  return {
    repoId: delivery.repoId,
    repo: delivery.repo,
    issueId: delivery.issue.id,
    issueNumber: delivery.issue.number,
    ...(delivery.installationId !== undefined ? { installationId: delivery.installationId } : {}),
  };
}

/**
 * Aplica uma entrega `issues` ao estado. Repositório não plugado, PR e ações fora do escopo não mudam nada.
 * Muta `state` (rascunho de uma transação durável) e devolve os efeitos que a fábrica deve executar.
 */
export function applyIssueDelivery(opts: {
  state: FactoryState;
  delivery: IssueDelivery;
  projects: WebhookProject[];
  newRef: () => string;
}): WebhookEffect[] {
  const { state, delivery, newRef } = opts;
  const achado = projetoDaEntrega(state, opts.projects, delivery);
  if (!achado) return [];
  const project = achado.project;
  if (project.config.source.type !== "github") return [];
  // Repositório desativado: nenhum evento de issue cria ou muda Tarefa (ADR-0015).
  if (repoDesativado(state, project.name)) return [];
  const issue = delivery.issue;
  if (issue.pull_request || delivery.action === "assigned" || delivery.action === "unassigned") return [];

  // Renomeado: a Tarefa segue o mesmo repositório, mas a configuração ainda tem o nome antigo. Avisa para atualizar o YAML.
  const avisoRenomeado: WebhookEffect[] = achado.renomeadoDe
    ? [
        {
          type: "notificar",
          project: project.name,
          target: project.name,
          reason: "repositorio-renomeado",
          message: `o repositório de ${project.name} mudou de nome no GitHub (era ${achado.renomeadoDe}, agora ${delivery.repo}). Atualize source.repo no YAML do projeto.`,
        },
      ]
    : [];
  return [...avisoRenomeado, ...efeitosDaIssue(state, project, delivery, newRef)];
}

/** Efeitos de uma issue que já tem projeto e passou pelas guardas: criar, encerrar, reabrir ou sinalizar mudança. */
function efeitosDaIssue(
  state: FactoryState,
  project: WebhookProject,
  delivery: IssueDelivery,
  newRef: () => string,
): WebhookEffect[] {
  const source = project.config.source;
  const issue = delivery.issue;
  const card = cardOfIssue({ project: source.project, assignee: source.assignee }, issue);
  const id = `${project.name}/${card.key}`;
  const { task, outraIdentidade } = tarefaDaEntrega(state, id, delivery);
  if (outraIdentidade) return [];

  if (delivery.action === "closed" || delivery.action === "deleted") {
    if (!task || TERMINAIS.has(task.status)) return [];
    task.reason = delivery.action === "closed" ? CLOSED_REASON : REMOVED_REASON;
    // Mesma regra do cancelamento pelo usuário: sem execução durável, a Tarefa termina aqui; com ela, a parada a fecha.
    if (task.durableId !== null) return [{ type: "abortar", id }];
    task.status = "cancelada";
    return [];
  }

  if (task) {
    if (delivery.action === "reopened" && task.status === "cancelada" && task.reason === CLOSED_REASON) {
      task.status = "enfileirada";
      task.reason = null;
    }
    if (TERMINAIS.has(task.status)) return [];
    task.title = issue.title;
    task.scope = scopeOf(issue.body);
    // Com a Tarefa em execução (ou com entrega pendente), o texto que o agente já leu ficou velho: marca e avisa.
    // Nos demais estados, a SPEC ainda não foi escrita e lê o card novo quando rodar.
    if (delivery.action === "edited" && EXECUTING.has(task.status)) {
      task.specDirty = true;
      if (task.status === "ativa") task.pauseRequested = true;
      return [
        {
          type: "notificar",
          project: project.name,
          target: card.key,
          reason: "escopo-alterado",
          message: `o escopo do card ${card.key} mudou no GitHub enquanto a Tarefa estava em andamento. ${
            task.status === "ativa"
              ? "A Tarefa pausa no próximo passo."
              : "A Tarefa é barrada antes de código novo ou da entrega."
          } Sem implementação iniciada, a SPEC é refeita; com ela iniciada, a Tarefa para para revisão.`,
        },
      ];
    }
    return [];
  }

  const cardState = project.config.statuses[card.status];
  if (!cardState || !isEligible(project.config, cardState, issue)) return [];
  // A chave já existe com outra identidade: não cria duplicata (o caso foi tratado acima, mas a guarda fica).
  if (state.tasks.some((t) => t.id === id)) return [];
  const origem = origemDaEntrega(delivery);
  state.tasks.push(
    novaTarefa({
      id,
      project: project.name,
      key: card.key,
      title: issue.title,
      ref: newRef(),
      startedIn: cardState,
      scope: scopeOf(issue.body),
      origem,
    }),
  );
  return [];
}

/** Uma issue vira Tarefa só se está aberta, num estado elegível, fora dos épicos e dentro das chaves permitidas. */
export function isEligible(config: ProjectConfig, cardState: CardState, issue: RawIssue): boolean {
  if (config.source.type !== "github") return false;
  if (issue.state !== "open") return false;
  if (!estadoElegivel(cardState)) return false;
  const key = `${config.source.project}-${issue.number}`;
  if (config.source.keys && !config.source.keys.includes(key)) return false;
  if ((issue.sub_issues_summary?.total ?? 0) > 0) return false;
  return !temRotuloIgnorado(labelNames(issue), config.source.ignoreLabels);
}

/**
 * Aplica um evento de instalação do App. Repositório removido ou instalação removida/suspensa desativa o projeto (com
 * um aviso por projeto); repositório adicionado reativa o projeto configurado. Repositório sem projeto no YAML não é
 * ativado: avisa para configurar, porque a configuração do projeto fica fora do repositório (ADR-0010).
 */
export function applyInstallationDelivery(opts: {
  state: FactoryState;
  delivery: InstallationDelivery;
  projects: WebhookProject[];
}): WebhookEffect[] {
  const { state, delivery, projects } = opts;
  const effects: WebhookEffect[] = [];
  const githubProjects = projects.filter((p) => p.config.source.type === "github");
  const projectOf = (repo: string) =>
    githubProjects.find(
      (p) => p.config.source.type === "github" && p.config.source.repo.toLowerCase() === repo.toLowerCase(),
    );
  const deactivate = (project: WebhookProject, repo: string, motivo: string) => {
    const result = desativarProjeto({ state, project: project.name, repo, motivo, force: false });
    effects.push(...result.effects, {
      type: "notificar",
      project: project.name,
      target: repo,
      reason: "repositorio-desvinculado",
      message: avisoDesativacao(repo, motivo, result.ativas),
    });
  };

  switch (delivery.action) {
    case "created":
    case "added":
      for (const repo of delivery.repos) {
        const project = projectOf(repo);
        if (!project) {
          effects.push({
            type: "notificar",
            project: "(sem projeto)",
            target: repo,
            reason: "repo-sem-projeto",
            message: `o App foi instalado no repositório ${repo}, mas não há projeto configurado para ele. Crie o YAML do projeto para monitorá-lo.`,
          });
          continue;
        }
        ativarProjeto({ state, project: project.name, repo, installationId: delivery.installationId });
        const repoId = delivery.repoIds?.[repo.toLowerCase()];
        if (repoId !== undefined) gravarRepoId(state, project.name, repo, repoId);
      }
      return effects;
    case "removed":
      for (const repo of delivery.repos) {
        const project = projectOf(repo);
        if (project) deactivate(project, repo, "repositório removido da instalação do App");
      }
      return effects;
    case "deleted":
    case "suspend": {
      const motivo = delivery.action === "deleted" ? "instalação do App removida" : "instalação do App suspensa";
      for (const project of githubProjects) {
        const binding = state.repos?.[project.name];
        if (binding?.status === "ativo" && binding.installationId === delivery.installationId)
          deactivate(project, binding.repo, motivo);
      }
      return effects;
    }
  }
}

function avisoDesativacao(repo: string, motivo: string, ativas: string[]): string {
  const base = `o repositório ${repo} foi desativado: ${motivo}. As Tarefas não iniciadas foram canceladas.`;
  return ativas.length > 0
    ? `${base} Tarefa em execução pausada, aguardando confirmação: ${ativas.join(", ")}. Desplugue com force para cancelá-la.`
    : base;
}

/**
 * Entregas que a reconciliação aplica: o que mudou no GitHub desde a última sincronização e ainda não está no estado.
 * Só gera entrega quando a versão da issue difere da Tarefa: uma edição falsa marcaria uma execução como desatualizada.
 * Cada versão tem um identificador próprio (número + última alteração), então reaplicar a mesma versão é no-op.
 */
export function reconciliarIssues(opts: {
  state: FactoryState;
  project: WebhookProject;
  snapshots: IssueSnapshot[];
}): IssueDelivery[] {
  const { state, project, snapshots } = opts;
  if (project.config.source.type !== "github") return [];
  const source = project.config.source;
  const deliveries: IssueDelivery[] = [];
  for (const s of snapshots) {
    if (s.pullRequest) continue;
    const task = state.tasks.find((t) => t.id === `${project.name}/${source.project}-${s.number}`);
    let action: IssueAction | undefined;
    if (s.state === "closed") {
      if (task && !TERMINAIS.has(task.status)) action = "closed";
    } else if (!task) {
      action = "opened";
    } else if (task.status === "cancelada" && task.reason === CLOSED_REASON) {
      action = "reopened";
    } else if (!TERMINAIS.has(task.status)) {
      // Sem `scope` (Tarefa criada pela busca), o corpo não é conhecido: só o título conta.
      const bodyChanged = task.scope !== undefined && task.scope !== null && task.scope.description !== (s.body ?? "");
      if (task.title !== s.title || bodyChanged) action = "edited";
    }
    if (!action) continue;
    const issue = {
      number: s.number,
      title: s.title,
      body: s.body,
      state: s.state,
      labels: s.labels.map((name) => ({ name })),
      sub_issues_summary: { total: s.subIssues },
    } as RawIssue;
    // Uma issue nova só vira entrega se for elegível (épico e status fora da fila ficam de fora, como no webhook).
    if (action === "opened") {
      const cardState =
        project.config.statuses[cardOfIssue({ project: source.project, assignee: source.assignee }, issue).status];
      if (!cardState || !isEligible(project.config, cardState, issue)) continue;
    }
    deliveries.push({
      deliveryId: `reconcile:${source.repo.toLowerCase()}#${s.number}@${s.updatedAt}`,
      action,
      repo: source.repo,
      issue,
    });
  }
  return deliveries;
}
