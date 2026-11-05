import type { CodeHost } from "./code-host.js";
import { type CardState, type ProjectConfig, STATE_ORDER } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import type { EventRecorder } from "./events.js";
import { redactSecrets } from "./secrets.js";

export const AUTOMATION_PREFIX = "🤖 [fábrica]";

/** Uma escrita recusada por guardrail. Nunca chega à Fonte. */
export class GuardrailViolation extends Error {
  override name = "GuardrailViolation";
}

/** Toda escrita externa da fábrica num projeto passa por aqui (ADR-0006). */
export interface EffectWriter {
  /** Cria um comentário próprio no card. Retorna o id (no dry-run, um id fictício). */
  comment(cardKey: string, body: string): Promise<{ id: string }>;
  /**
   * Como `comment`, mas idempotente: se a fábrica já escreveu um comentário com o mesmo conteúdo no card,
   * devolve esse comentário em vez de criar outro (ex.: ao repetir um passo depois de um reinício).
   */
  commentOnce(cardKey: string, body: string): Promise<{ id: string }>;
  /**
   * Comentário próprio identificado por título (ex.: "SPEC"), editado no lugar: a primeira linha é o prefixo de
   * automação seguido do título. Cria na primeira vez, edita nas seguintes e não escreve nada se o conteúdo não mudou.
   * Só considera comentários escritos pelo usuário da fábrica; um de outra pessoa com o mesmo título é ignorado.
   */
  upsertComment(cardKey: string, title: string, body: string): Promise<{ id: string }>;
  /** Edita um comentário criado pela própria fábrica. */
  editComment(cardKey: string, commentId: string, body: string): Promise<void>;
  /**
   * Move o card para o status mapeado para `state`, nunca além de `transitionLimit`.
   * Com `from`, bloqueia se o card não estiver mais nesse estado (ex.: uma pessoa o moveu nesse meio-tempo).
   */
  transition(cardKey: string, state: CardState, opts?: { from?: CardState }): Promise<void>;
  /**
   * Envia `branch` do clone em `repoPath` para o remoto, pelo CodeHost. Nunca em `main`/`master`/`develop`;
   * force-push só numa branch da fábrica (registrada no estado durável de uma Tarefa).
   */
  pushBranch(repoPath: string, branch: string, opts?: { force?: boolean }): Promise<void>;
}

/** Branches em que a fábrica nunca faz push. */
export const PROTECTED_BRANCHES: ReadonlySet<string> = new Set(["main", "master", "develop"]);

export function createEffectWriter(opts: {
  config: ProjectConfig;
  source: DemandSource;
  events: EventRecorder;
  /** Estado mais avançado para onde a fábrica pode mover um card neste marco. */
  transitionLimit: CardState;
  /** Porta do remoto de código. Sem ela, todo push é recusado. */
  codeHost?: CodeHost;
  /** Se `branch` é uma branch da fábrica neste projeto, segundo o estado durável. Sem ele, nenhuma é. */
  isFactoryBranch?: (branch: string) => boolean | Promise<boolean>;
}): EffectWriter {
  const { config, source, events } = opts;
  const user = config.source.assignee;
  const dryRunIds = new Set<string>();

  /** Aplica os guardrails, registra e executa (ou só registra, no dry-run). */
  async function write<T>(
    w: { target: string; action: string; content: string },
    check: () => Promise<string | undefined>,
    run: () => Promise<T>,
    dry: () => T,
  ): Promise<T> {
    const reason = await check();
    if (reason) {
      await events.append({ type: "blocked", project: config.name, ...w, reason });
      throw new GuardrailViolation(`Guardrail: ${w.action} em ${w.target} bloqueado: ${reason}`);
    }
    await events.append({ type: "write", project: config.name, ...w, dryRun: config.dryRun });
    return config.dryRun ? dry() : run();
  }

  async function cardNotOwned(key: string): Promise<string | undefined> {
    const card = await source.getCard(key);
    if (!card) return `card ${key} não existe no projeto ${config.name}`;
    if (card.assignee !== user) return `card ${key} está atribuído a ${card.assignee}, não a ${user}`;
    return undefined;
  }

  /** Toda mensagem sai sem segredos e com o prefixo de automação. */
  const outgoing = (body: string) => {
    const clean = redactSecrets(body);
    return clean.startsWith(AUTOMATION_PREFIX) ? clean : `${AUTOMATION_PREFIX} ${clean}`;
  };
  const statusFor = (state: CardState) => Object.entries(config.statuses).find(([, s]) => s === state)?.[0];

  return {
    comment(cardKey, body) {
      const content = outgoing(body);
      return write(
        { target: cardKey, action: "comment", content },
        () => cardNotOwned(cardKey),
        () => source.addComment(cardKey, content),
        () => {
          const id = `dry-run-${dryRunIds.size + 1}`;
          dryRunIds.add(id);
          return { id };
        },
      );
    },

    async commentOnce(cardKey, body) {
      if (!config.dryRun) {
        const content = outgoing(body);
        const existing = (await source.listComments(cardKey)).find((c) => c.author === user && c.body === content);
        if (existing) return { id: existing.id };
      }
      return this.comment(cardKey, body);
    },

    async upsertComment(cardKey, title, body) {
      const content = outgoing(`${title}\n\n${body}`);
      const header = content.split("\n")[0];
      const existing = (await source.listComments(cardKey)).find(
        (c) => c.author === user && c.body.split("\n")[0] === header,
      );
      if (!existing) return this.comment(cardKey, content);
      if (existing.body !== content) await this.editComment(cardKey, existing.id, content);
      return { id: existing.id };
    },

    editComment(cardKey, commentId, body) {
      const content = outgoing(body);
      return write(
        { target: `${cardKey}#${commentId}`, action: "edit-comment", content },
        async () => {
          const notOwned = await cardNotOwned(cardKey);
          if (notOwned || dryRunIds.has(commentId)) return notOwned;
          const comment = (await source.listComments(cardKey)).find((c) => c.id === commentId);
          if (!comment) return `comentário ${commentId} não existe em ${cardKey}`;
          if (comment.author !== user || !comment.body.startsWith(AUTOMATION_PREFIX))
            return `comentário ${commentId} não foi escrito pela fábrica`;
          return undefined;
        },
        () => source.editComment(cardKey, commentId, content),
        () => undefined,
      );
    },

    async transition(cardKey, state, transitionOpts) {
      const status = statusFor(state) ?? "";
      // Já está no destino (ex.: o passo é repetido depois de um reinício): nada a escrever.
      const before = config.dryRun ? undefined : await source.getCard(cardKey);
      if (before && before.assignee === user && config.statuses[before.status] === state) return;
      return write(
        { target: cardKey, action: "transition", content: status || state },
        async () => {
          if (state === "backlog") return "a fábrica não devolve cards ao backlog";
          if (STATE_ORDER.indexOf(state) > STATE_ORDER.indexOf(opts.transitionLimit))
            return `${state} está além do limite ${opts.transitionLimit} deste marco`;
          if (!status) return `nenhum status mapeado para ${state}`;
          const notOwned = await cardNotOwned(cardKey);
          if (notOwned || !transitionOpts?.from) return notOwned;
          const card = await source.getCard(cardKey);
          const current = card && config.statuses[card.status];
          if (current !== transitionOpts.from)
            return `card ${cardKey} está em "${card?.status}", não mais em ${transitionOpts.from}`;
          return undefined;
        },
        () => source.transition(cardKey, status),
        () => undefined,
      );
    },

    pushBranch(repoPath, branch, pushOpts) {
      const force = pushOpts?.force ?? false;
      const name = branch.replace(/^refs\/heads\//, "");
      return write(
        { target: name, action: force ? "force-push" : "push", content: `${repoPath} -> origin/${name}` },
        async () => {
          if (PROTECTED_BRANCHES.has(name)) return `push na branch protegida "${name}" é proibido`;
          if (force && !(await opts.isFactoryBranch?.(name)))
            return `force-push só nas branches da fábrica; "${name}" não é uma delas`;
          if (!opts.codeHost) return "projeto sem CodeHost configurado";
          return undefined;
        },
        () => (opts.codeHost as CodeHost).pushBranch(repoPath, name, { force }),
        () => undefined,
      );
    },
  };
}
