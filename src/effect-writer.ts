import { type CardState, type ProjectConfig, STATE_ORDER } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import type { EventLog } from "./events.js";
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
  /** Edita um comentário criado pela própria fábrica. */
  editComment(cardKey: string, commentId: string, body: string): Promise<void>;
  /** Move o card para o status mapeado para `state`, nunca além de `transitionLimit`. */
  transition(cardKey: string, state: CardState): Promise<void>;
}

export function createEffectWriter(opts: {
  config: ProjectConfig;
  source: DemandSource;
  events: EventLog;
  /** Estado mais avançado para onde a fábrica pode mover um card neste marco. */
  transitionLimit: CardState;
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
      events.append({ type: "blocked", project: config.name, ...w, reason });
      throw new GuardrailViolation(`Guardrail: ${w.action} em ${w.target} bloqueado: ${reason}`);
    }
    events.append({ type: "write", project: config.name, ...w, dryRun: config.dryRun });
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

    transition(cardKey, state) {
      const status = statusFor(state) ?? "";
      return write(
        { target: cardKey, action: "transition", content: status || state },
        async () => {
          if (state === "backlog") return "a fábrica não devolve cards ao backlog";
          if (STATE_ORDER.indexOf(state) > STATE_ORDER.indexOf(opts.transitionLimit))
            return `${state} está além do limite ${opts.transitionLimit} deste marco`;
          if (!status) return `nenhum status mapeado para ${state}`;
          return cardNotOwned(cardKey);
        },
        () => source.transition(cardKey, status),
        () => undefined,
      );
    },
  };
}
