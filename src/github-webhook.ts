import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { CardState, ProjectConfig } from "./config.js";
import type { IssueSnapshot } from "./demand-source.js";
import type { FactoryState, QueuedTask } from "./durable.js";
import { cardOfIssue, labelNames, type RawIssue } from "./github-demand-source.js";
import { ativarProjeto, desativarProjeto, repoDesativado } from "./repositorios.js";

const PREFIX = "sha256=";

/**
 * Confere o cabeçalho `X-Hub-Signature-256` do GitHub: HMAC-SHA256 do corpo cru (bytes, não texto) com o secret do App.
 * Falha fechado: sem secret, sem cabeçalho, prefixo diferente ou formato inválido resultam em `false`, nunca em erro.
 * A comparação é em tempo constante.
 */
export function verifyGitHubSignature(opts: { secret: string; body: Buffer; signature: string | undefined }): boolean {
  const { secret, body, signature } = opts;
  if (!secret || !signature?.startsWith(PREFIX)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const received = Buffer.from(signature.slice(PREFIX.length), "hex");
  // `Buffer.from` ignora caracteres inválidos em hex: a conferência de tamanho e a re-codificação os barram.
  if (received.length !== expected.length || received.toString("hex") !== signature.slice(PREFIX.length).toLowerCase())
    return false;
  return timingSafeEqual(expected, received);
}

// --- Parse do payload -----------------------------------------------------------------------------

/** Ações de `issues` que a fábrica conhece. Outras (ex.: `labeled`, `transferred`) são ignoradas. */
const ISSUE_ACTIONS = ["opened", "edited", "closed", "deleted", "reopened", "assigned", "unassigned"] as const;
export type IssueAction = (typeof ISSUE_ACTIONS)[number];

export type IssueDelivery = {
  /** Identificador da entrega (`X-GitHub-Delivery`), para idempotência. */
  deliveryId: string;
  action: IssueAction;
  /** Repositório "dono/nome", como veio no payload. */
  repo: string;
  issue: RawIssue;
};

/** Ações de instalação que a fábrica trata: a instalação do App e os repositórios que ela alcança. */
export type InstallationAction = "created" | "deleted" | "suspend" | "added" | "removed";

export type InstallationDelivery = {
  deliveryId: string;
  action: InstallationAction;
  installationId: number;
  /** Repositórios "dono/nome" que a ação afeta (vazio quando o payload não os traz). */
  repos: string[];
};

export type ParsedDelivery =
  | { kind: "issues"; delivery: IssueDelivery }
  | { kind: "instalacao"; delivery: InstallationDelivery }
  | { kind: "ignorado"; reason: string }
  | { kind: "invalido"; reason: string };

const InstallationPayload = z
  .object({
    action: z.string(),
    installation: z.object({ id: z.number().int().positive() }).passthrough(),
    repositories: z.array(z.object({ full_name: z.string() }).passthrough()).optional(),
    repositories_added: z.array(z.object({ full_name: z.string() }).passthrough()).optional(),
    repositories_removed: z.array(z.object({ full_name: z.string() }).passthrough()).optional(),
  })
  .passthrough();

/** Ações tratadas por evento. `unsuspend` fica de fora de propósito: o repositório volta pelo plugue, não sozinho. */
const INSTALLATION_ACTIONS: Record<string, readonly InstallationAction[]> = {
  installation: ["created", "deleted", "suspend"],
  installation_repositories: ["added", "removed"],
};

const IssuesPayload = z
  .object({
    action: z.string(),
    issue: z
      .object({
        number: z.number().int().positive(),
        title: z.string(),
        body: z.string().nullish(),
        state: z.string(),
        labels: z.array(z.union([z.string(), z.object({ name: z.string().optional() }).passthrough()])).optional(),
        pull_request: z.unknown().optional(),
        sub_issues_summary: z.object({ total: z.number().optional() }).passthrough().nullish(),
      })
      .passthrough(),
    repository: z.object({ full_name: z.string().min(3) }).passthrough(),
  })
  .passthrough();

/** Interpreta uma entrega do GitHub: `issues`, e instalação do App (`installation`, `installation_repositories`). */
export function parseGitHubDelivery(opts: {
  event: string | undefined;
  deliveryId: string | undefined;
  body: unknown;
}): ParsedDelivery {
  if (opts.event && opts.event in INSTALLATION_ACTIONS) return parseInstallation(opts.event, opts);
  if (opts.event !== "issues") return { kind: "ignorado", reason: `evento ${opts.event ?? "(sem nome)"} não tratado` };
  if (!opts.deliveryId) return { kind: "invalido", reason: "entrega sem X-GitHub-Delivery" };
  const parsed = IssuesPayload.safeParse(opts.body);
  if (!parsed.success) return { kind: "invalido", reason: "payload de issues incompleto" };
  const { action, issue, repository } = parsed.data;
  if (!(ISSUE_ACTIONS as readonly string[]).includes(action))
    return { kind: "ignorado", reason: `ação issues.${action} não tratada` };
  return {
    kind: "issues",
    delivery: {
      deliveryId: opts.deliveryId,
      action: action as IssueAction,
      repo: repository.full_name,
      issue: issue as RawIssue,
    },
  };
}

function parseInstallation(event: string, opts: { deliveryId: string | undefined; body: unknown }): ParsedDelivery {
  if (!opts.deliveryId) return { kind: "invalido", reason: "entrega sem X-GitHub-Delivery" };
  const parsed = InstallationPayload.safeParse(opts.body);
  if (!parsed.success) return { kind: "invalido", reason: `payload de ${event} incompleto` };
  const { action, installation } = parsed.data;
  if (!INSTALLATION_ACTIONS[event]?.includes(action as InstallationAction))
    return { kind: "ignorado", reason: `ação ${event}.${action} não tratada` };
  const repos =
    (action === "added"
      ? parsed.data.repositories_added
      : action === "removed"
        ? parsed.data.repositories_removed
        : parsed.data.repositories) ?? [];
  return {
    kind: "instalacao",
    delivery: {
      deliveryId: opts.deliveryId,
      action: action as InstallationAction,
      installationId: installation.id,
      repos: repos.map((r) => r.full_name),
    },
  };
}

// --- Aplicação ao estado durável ------------------------------------------------------------------

/** Efeito que o estado sozinho não executa: a fábrica precisa parar uma execução durável. */
export type WebhookEffect =
  | { type: "abortar"; id: string }
  /** Aviso ao usuário, consolidado pela camada de eventos (um por mudança de escopo). */
  | {
      type: "notificar";
      project: string;
      target: string;
      reason: "escopo-alterado" | "repositorio-desvinculado" | "repo-sem-projeto";
      message: string;
    };

export type WebhookProject = { name: string; config: ProjectConfig };

/** Motivos gravados na Tarefa; a reabertura só devolve à fila o que o próprio fechamento cancelou. */
export const CLOSED_REASON = "issue fechada no GitHub";
export const REMOVED_REASON = "issue removida no GitHub";

/** Estados em que a Tarefa é elegível para a fila (mesma regra da busca na Fonte). */
const ELIGIBLE: ReadonlySet<CardState> = new Set<CardState>(["todo", "in_progress"]);
const TERMINAL: ReadonlySet<string> = new Set(["concluida", "cancelada", "bloqueada", "vetada", "recusada"]);
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
  const repo = delivery.repo.toLowerCase();
  const project = opts.projects.find(
    (p) => p.config.source.type === "github" && p.config.source.repo.toLowerCase() === repo,
  );
  if (project?.config.source.type !== "github") return [];
  // Repositório desativado: nenhum evento de issue cria ou muda Tarefa (ADR-0015).
  if (repoDesativado(state, project.name)) return [];
  const source = project.config.source;
  const issue = delivery.issue;
  if (issue.pull_request || delivery.action === "assigned" || delivery.action === "unassigned") return [];

  const card = cardOfIssue({ project: source.project, assignee: source.assignee }, issue);
  const id = `${project.name}/${card.key}`;
  const task = state.tasks.find((t) => t.id === id);

  if (delivery.action === "closed" || delivery.action === "deleted") {
    if (!task || TERMINAL.has(task.status)) return [];
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
    if (TERMINAL.has(task.status)) return [];
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
  state.tasks.push({
    id,
    project: project.name,
    key: card.key,
    title: issue.title,
    ref: newRef(),
    status: "enfileirada",
    durableId: null,
    gateId: null,
    pauseRequested: false,
    notBefore: null,
    attempts: 0,
    reason: null,
    startedIn: cardState,
    veto: null,
    delivery: null,
    implementation: null,
    scope: scopeOf(issue.body),
  });
  return [];
}

/** Uma issue vira Tarefa só se está aberta, num estado elegível, fora dos épicos e dentro das chaves permitidas. */
function isEligible(config: ProjectConfig, cardState: CardState, issue: RawIssue): boolean {
  if (config.source.type !== "github") return false;
  if (issue.state !== "open") return false;
  if (!ELIGIBLE.has(cardState)) return false;
  const key = `${config.source.project}-${issue.number}`;
  if (config.source.keys && !config.source.keys.includes(key)) return false;
  if ((issue.sub_issues_summary?.total ?? 0) > 0) return false;
  const ignored = new Set((config.source.ignoreLabels ?? ["epic"]).map((l) => l.toLowerCase()));
  return !labelNames(issue).some((l) => ignored.has(l.toLowerCase()));
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
      if (task && !TERMINAL.has(task.status)) action = "closed";
    } else if (!task) {
      action = "opened";
    } else if (task.status === "cancelada" && task.reason === CLOSED_REASON) {
      action = "reopened";
    } else if (!TERMINAL.has(task.status)) {
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
