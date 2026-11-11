import type { Context } from "@earendil-works/chord/context";
import type { Harness, TaskId } from "@earendil-works/pi-durable";
import type { AvisoLote } from "./aviso-lote.js";
import type { ProjectConfig } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import type { FactoryState } from "./durable.js";
import type { createGitHubAppChecker } from "./github-app.js";
import {
  applyInstallationDelivery as applyInstallationToState,
  applyIssueDelivery as applyToState,
  type InstallationDelivery,
  type IssueDelivery,
  reconciliarIssues,
  type WebhookEffect,
  type WebhookProject,
} from "./github-webhook.js";
import {
  criarRepositoriosGitHub,
  type EstadoRepositorios,
  projetoDoRepositorio,
} from "./packages/repositorios-github/index.js";
import {
  aplicarEntrega,
  type EstadoSincronizacao,
  executarEfeitosWebhook,
  type PortasSincronizacao,
  reconciliar,
} from "./packages/sincronizacao-github/index.js";
import { repoDesativado } from "./repositorios.js";
import { newTaskRef } from "./retro-stage.js";

/** Peças da fábrica que a integração com o GitHub usa. */
export interface DepsIntegracaoGitHub {
  projects: ReadonlyMap<string, { config: ProjectConfig; source: DemandSource }>;
  readState(): Promise<FactoryState>;
  alterar: <E, T>(fn: (estado: E) => T) => Promise<T>;
  clock: { now(): number };
  harness: Harness;
  context: Context;
  avisos: AvisoLote;
  appChecker: Pick<ReturnType<typeof createGitHubAppChecker>, "status">;
  webhook: { port: number } | undefined;
}

/** Integração com o GitHub: as entregas do webhook, a reconciliação e as leituras dos repositórios monitorados. */
export function criarIntegracaoGitHub(deps: DepsIntegracaoGitHub) {
  const { projects, readState, clock, harness, context, avisos, appChecker, webhook } = deps;
  const alterar = deps.alterar;
  const webhookProjects = (): WebhookProject[] =>
    [...projects.values()].map((p) => ({ name: p.config.name, config: p.config }));

  /** Executa os efeitos de uma entrega do webhook: a regra (abortar só o que existe, avisar o resto) está no pacote. */
  async function runWebhookEffects(effects: WebhookEffect[]): Promise<void> {
    await executarEfeitosWebhook(
      {
        execucaoDe: async (tarefaId) => (await readState()).tasks.find((t) => t.id === tarefaId)?.durableId,
        abortar: async (idExecucao) => {
          await harness.abortTask(idExecucao as TaskId, context);
        },
        notificar: async (efeito) => {
          await avisos.add({
            type: "notificar",
            project: efeito.project,
            target: efeito.target,
            reason: efeito.reason,
            message: efeito.message,
          });
        },
      },
      effects,
    );
  }

  // Sincronização com o GitHub (reconciliação e entregas do webhook): a regra está no pacote sincronizacao-github. A
  // fábrica fornece o estado, os projetos, o webhook e os efeitos.
  type SnapshotGitHub = Parameters<typeof reconciliarIssues>[0]["snapshots"][number];
  const sincronizacao: PortasSincronizacao<
    SnapshotGitHub,
    ProjectConfig,
    IssueDelivery | InstallationDelivery,
    WebhookEffect
  > = {
    agora: () => clock.now(),
    projetos: () =>
      [...projects.values()].flatMap(({ config, source }) =>
        config.source.type === "github" && source.listChangedSince
          ? [
              {
                nome: config.name,
                configuracao: config,
                // Chamado pelo objeto da Fonte, para manter o `this` do adaptador.
                listarMudancasDesde: (desde: string) => source.listChangedSince?.(desde) ?? Promise.resolve([]),
              },
            ]
          : [],
      ),
    estado: () => readState() as unknown as Promise<EstadoSincronizacao>,
    alterar: alterar,
    repoDesativado: (estado, nome) => repoDesativado(estado as FactoryState, nome),
    reconciliar: (estado, projeto, snapshots) =>
      reconciliarIssues({
        state: estado as FactoryState,
        project: { name: projeto.nome, config: projeto.configuracao },
        snapshots,
      }),
    aplicar: (estado, entrega) =>
      "repo" in entrega
        ? applyToState({
            state: estado as FactoryState,
            delivery: entrega,
            projects: webhookProjects(),
            newRef: newTaskRef,
          })
        : applyInstallationToState({ state: estado as FactoryState, delivery: entrega, projects: webhookProjects() }),
    executarEfeitos: (efeitos) => runWebhookEffects(efeitos),
  };

  /**
   * Reconciliação (ADR-0015): consulta o que mudou nos repositórios desde a última sincronização e aplica o que o webhook
   * não entregou.
   */
  async function reconcileRepos(): Promise<void> {
    await reconciliar(sincronizacao);
  }

  /**
   * Aplica uma entrega do GitHub (issue ou instalação do App) ao estado e executa os efeitos. Um reenvio de entrega já
   * aplicada não muda nada.
   */
  async function applyGitHubDelivery(delivery: IssueDelivery | InstallationDelivery): Promise<void> {
    await aplicarEntrega(sincronizacao, delivery);
  }

  /** Acha o projeto monitorado de um repositório (`dono/nome`, sem diferenciar caixa). */
  const projectByRepo = (repo: string): string | undefined =>
    projetoDoRepositorio(projetosGitHubDaFabrica(), repo)?.nome;

  /** Projetos de repositório monitorado da fábrica, com o repositório de cada um. */
  const projetosGitHubDaFabrica = () =>
    [...projects.values()].flatMap(({ config }) =>
      config.source.type === "github" ? [{ nome: config.name, repo: config.source.repo }] : [],
    );
  // Leituras de repositórios do GitHub (vínculos, catálogo, painel): no pacote repositorios-github. A fábrica fornece o
  // estado, os projetos de repositório monitorado, a situação do App e o receptor do webhook.
  const repositoriosGitHub = criarRepositoriosGitHub({
    estado: () => readState() as unknown as Promise<EstadoRepositorios>,
    projetosGitHub: () => projetosGitHubDaFabrica(),
    statusDoApp: () => appChecker.status(),
    receptor: () => ({ ligado: webhook !== undefined, porta: webhook?.port ?? null }),
  });
  const listRepos = () => repositoriosGitHub.listar();
  const githubReposCatalog = () => repositoriosGitHub.catalogo();
  const githubAppPanel = () => repositoriosGitHub.painel();

  return {
    webhookProjects,
    runWebhookEffects,
    reconcileRepos,
    applyGitHubDelivery,
    projectByRepo,
    listRepos,
    githubReposCatalog,
    githubAppPanel,
  };
}
