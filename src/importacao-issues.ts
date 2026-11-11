import type { CardState } from "./config.js";
import type { FactoryState, OrigemGitHub, QueuedTask } from "./durable.js";
import { novaTarefa } from "./estado-fabrica.js";
import { cardOfIssue, type RawIssue } from "./github-demand-source.js";
import { tarefaDaIssue } from "./github-identidade.js";
import {
  applyIssueDelivery,
  gravarRepoId,
  isEligible,
  scopeOf,
  type WebhookEffect,
  type WebhookProject,
} from "./github-webhook.js";

/**
 * Importação de issues abertas de um repositório (plano de migração, Fase 3). Função pura sobre o estado: o daemon
 * faz a leitura no GitHub e a escrita durável; aqui só se decide o que cada issue vira.
 *
 * Regras, por issue aberta que não é PR:
 * - já importada (mesma origem): atualiza título e escopo pelo mesmo caminho do webhook, sem criar nada;
 * - Tarefa da busca antiga com a mesma chave e sem origem: recebe a origem (vinculada), sem duplicar;
 * - nova: vira Tarefa só se a regra de elegibilidade do webhook aceitar (estado, épico, label ignorado).
 * Rodar de novo com as mesmas issues não muda nada: é idempotente.
 */

export interface ResultadoImportacao {
  criadas: number;
  vinculadas: number;
  atualizadas: number;
  ignoradas: number;
}

export function aplicarImportacao(opts: {
  state: FactoryState;
  project: WebhookProject;
  repoId: number;
  repo: string;
  installationId?: number;
  issues: RawIssue[];
  newRef: () => string;
}): { resultado: ResultadoImportacao; effects: WebhookEffect[] } {
  const { state, project, repoId, repo, installationId, newRef } = opts;
  const source = project.config.source;
  if (source.type !== "github") throw new Error(`projeto ${project.name} não é de repositório monitorado`);
  const resultado: ResultadoImportacao = { criadas: 0, vinculadas: 0, atualizadas: 0, ignoradas: 0 };
  // O vínculo passa a conhecer o id: entregas futuras acham o projeto mesmo se o repositório for renomeado.
  gravarRepoId(state, project.name, repo, repoId);
  const effects: WebhookEffect[] = [];

  for (const issue of opts.issues) {
    // Pull requests vêm no endpoint de issues: não são demanda.
    if (issue.pull_request) continue;
    if (issue.id === undefined) {
      resultado.ignoradas++;
      continue;
    }
    const card = cardOfIssue({ project: source.project, assignee: source.assignee }, issue);
    const id = `${project.name}/${card.key}`;
    const origem: OrigemGitHub = {
      repoId,
      repo,
      issueId: issue.id,
      issueNumber: issue.number,
      ...(installationId !== undefined ? { installationId } : {}),
    };

    const jaImportada = tarefaDaIssue(state.tasks, repoId, issue.number);
    const legada = state.tasks.find((t) => t.id === id && t.origem === undefined);
    const existente = jaImportada ?? legada;
    if (existente) {
      if (legada && !jaImportada) {
        legada.origem = origem;
        resultado.vinculadas++;
      } else {
        resultado.atualizadas++;
      }
      // Mesmo caminho do webhook de edição: atualiza o texto e avisa se uma execução já o leu.
      effects.push(
        ...applyIssueDelivery({
          state,
          delivery: {
            deliveryId: `importacao-${repoId}-${issue.number}`,
            action: "edited",
            repo,
            repoId,
            ...(installationId !== undefined ? { installationId } : {}),
            issue,
          },
          projects: [project],
          newRef,
        }),
      );
      continue;
    }

    // Outra Tarefa já usa esta chave com outra origem: não cria duplicata, a identidade fica com a primeira.
    if (state.tasks.some((t) => t.id === id)) {
      resultado.ignoradas++;
      continue;
    }
    const cardState = project.config.statuses[card.status];
    if (!cardState || !isEligible(project.config, cardState, issue)) {
      resultado.ignoradas++;
      continue;
    }
    state.tasks.push(
      tarefaNovaDaIssue({
        id,
        projectName: project.name,
        key: card.key,
        title: issue.title,
        origem,
        cardState,
        issue,
        newRef,
      }),
    );
    resultado.criadas++;
  }

  return { resultado, effects };
}

/** Tarefa nova de uma issue importada: a mesma forma que o webhook cria (ver `novaTarefa`). */
function tarefaNovaDaIssue(opts: {
  id: string;
  projectName: string;
  key: string;
  title: string;
  origem: OrigemGitHub;
  cardState: CardState;
  issue: RawIssue;
  newRef: () => string;
}): QueuedTask {
  return novaTarefa({
    id: opts.id,
    project: opts.projectName,
    key: opts.key,
    title: opts.title,
    ref: opts.newRef(),
    startedIn: opts.cardState,
    origem: opts.origem,
    scope: scopeOf(opts.issue.body),
  });
}
