import type { ChangeRequest, CodeHost, RequestDraft } from "./code-host.js";
import { type CardState, type ProjectConfig, STATE_ORDER } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import { criarEfeitosDeCodigo } from "./effect-writer-codigo.js";
import { criarEfeitosDeRetro } from "./effect-writer-retro.js";
import { criarMotorDeEscrita } from "./escrita-efeitos.js";
import type { EventRecorder } from "./events.js";

import { isAutomationText, mesmoTexto, stripAutomationMark, withAutomationMark } from "./marca-automacao.js";
import type { RetroSink } from "./retro-sink.js";
import { redactSecrets } from "./secrets.js";

/**
 * Toda escrita externa da fábrica num projeto passa por aqui (ADR-0006).
 *
 * No dry-run, as escritas só são registradas (eventos `write` com `dryRun: true`). As idempotentes (todas menos
 * `comment`) são registradas uma vez só por destino, ação e conteúdo, inclusive depois de um reinício: o registro fica
 * no log de eventos durável.
 */
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
  /**
   * Comentário próprio que menciona `personId` (pergunta, lembrete). Só para as pessoas do projeto: qualquer outro
   * destinatário é bloqueado. Idempotente como `commentOnce`.
   */
  mention(cardKey: string, personId: string, body: string): Promise<{ id: string }>;
  /** Edita um comentário criado pela própria fábrica. */
  editComment(cardKey: string, commentId: string, body: string): Promise<void>;
  /**
   * Move o card para o status mapeado para `state`, nunca além de `transitionLimit`.
   * Com `from`, bloqueia se o card não estiver mais nesse estado (ex.: uma pessoa o moveu nesse meio-tempo).
   */
  transition(cardKey: string, state: CardState, opts?: { from?: CardState }): Promise<void>;
  /** Baixa da triagem: fecha o card com o motivo, pela Fonte (só as que têm triagem). Idempotente. */
  dismiss(cardKey: string, reason: "completed" | "not_planned" | "duplicate"): Promise<void>;
  /**
   * Envia `branch` do clone em `repoPath` para o remoto, pelo CodeHost. Nunca em `main`/`master`/`develop`;
   * force-push só numa branch da fábrica (criada por ela e registrada no estado durável de uma Tarefa;
   * uma branch adotada do remoto não conta).
   */
  pushBranch(repoPath: string, branch: string, opts?: { force?: boolean }): Promise<void>;
  /** Cria/localiza PR/MR da branch revisada; dry-run só registra, nunca consulta um merge fictício. */
  ensureRequest(cardKey: string, repoPath: string, draft: RequestDraft): Promise<ChangeRequest | undefined>;
  /**
   * Abre uma issue `retro` no repositório **público** da fábrica pelo RetroSink. Só no repositório configurado; o
   * título e o corpo passam pelo filtro de segredos e pelo saneamento dos valores do projeto (e do card `cardKey`), e
   * a escrita é barrada se sobrar algum. No dry-run, só registra e devolve `undefined`.
   */
  openRetroIssue(
    cardKey: string,
    repo: string,
    issue: { title: string; body: string },
  ): Promise<{ number: number; url: string } | undefined>;
  /** Aplica o mesmo saneamento público para comparar textos já publicados. */
  publicRetroText(cardKey: string, text: string): Promise<string>;
  /** Sinaliza valores privados que o saneamento não conseguiu remover. */
  publicRetroPreview(cardKey: string, text: string): Promise<{ text: string; leftovers: string[] }>;
  /** Comenta numa issue do repositório da fábrica, com as mesmas regras de `openRetroIssue`. */
  commentRetroIssue(cardKey: string, repo: string, issue: number, body: string): Promise<void>;
}

/** Branches em que a fábrica nunca faz push. */
export { PROTECTED_BRANCHES } from "./effect-writer-codigo.js";

export function createEffectWriter(opts: {
  config: ProjectConfig;
  source: DemandSource;
  events: EventRecorder;
  /** Estado mais avançado para onde a fábrica pode mover um card neste marco. */
  transitionLimit: CardState;
  /** Porta do remoto de código. Sem ela, todo push é recusado. */
  codeHost?: CodeHost;
  /** Se `branch` foi criada pela fábrica neste projeto, segundo o estado durável. Sem ele, nenhuma é. */
  isFactoryBranch?: (branch: string) => boolean | Promise<boolean>;
  /** Confere identidade da Tarefa, clone, base e review aprovado do HEAD atual. */
  isReviewedBranch?: (cardKey: string, repoPath: string, draft: RequestDraft) => Promise<boolean>;
  /** Issues da fábrica: a porta e o único repositório em que ela escreve. */
  retro?: { sink?: RetroSink; repo?: string };
}): EffectWriter {
  const { config, source, events } = opts;
  const user = config.source.assignee;
  // Comentário da própria fábrica com o mesmo texto (sem a marca), se já existe na Fonte.
  const comentarioIgual = (cardKey: string, content: string) =>
    source
      .listComments(cardKey)
      .then((comentarios) =>
        comentarios.find(
          (c) => c.author === user && mesmoTexto(withAutomationMark(stripAutomationMark(c.body)), content),
        ),
      );
  const motor = criarMotorDeEscrita({ config, events });
  const { authorize, write, dryRunComment } = motor;
  const dryRunIds = motor.dryRunIds;

  /** Cria um comentário próprio no card; `once` como em `write`. */
  function addOwnComment(cardKey: string, body: string, once: boolean): Promise<{ id: string }> {
    const content = outgoing(body);
    return write(
      { target: cardKey, action: "comment", content },
      () => cardNotOwned(cardKey),
      () => source.addComment(cardKey, content),
      dryRunComment,
      once,
    );
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
    return withAutomationMark(isAutomationText(clean) ? stripAutomationMark(clean) : clean);
  };
  const efeitosDeCodigo = criarEfeitosDeCodigo({
    codeHost: opts.codeHost,
    isFactoryBranch: opts.isFactoryBranch,
    isReviewedBranch: opts.isReviewedBranch,
    write,
    cardNotOwned,
    outgoing,
  });
  const efeitosDeRetro = criarEfeitosDeRetro({ config, source, retro: opts.retro, write });

  const statusFor = (state: CardState) => Object.entries(config.statuses).find(([, s]) => s === state)?.[0];

  return {
    ...efeitosDeRetro,
    comment(cardKey, body) {
      return addOwnComment(cardKey, body, false);
    },

    async commentOnce(cardKey, body) {
      if (!config.dryRun) {
        const content = outgoing(body);
        const existing = await comentarioIgual(cardKey, content);
        if (existing) return { id: existing.id };
      }
      return addOwnComment(cardKey, body, true);
    },

    async mention(cardKey, personId, body) {
      // A menção vai no comentário, no formato da própria Fonte (ADR-0020). O Teams segue como aviso à parte.
      const content = outgoing(`${source.formatMention(personId)} ${body}`);
      const effect = { target: cardKey, action: "mention", content };
      const check = async () => {
        if (!config.people.some((p) => p.id === personId))
          return `${personId} não está entre as pessoas do projeto ${config.name}`;
        return cardNotOwned(cardKey);
      };
      // Deduplicação não é autorização: uma pessoa pode ter sido revogada,
      // ou o mesmo conteúdo pode agora ser dirigido a outra pessoa.
      await authorize(effect, check);
      if (!config.dryRun) {
        const existing = await comentarioIgual(cardKey, content);
        if (existing) return { id: existing.id };
      }
      // Revalida também após a leitura assíncrona, antes do envio efetivo.
      return write(effect, check, () => source.addComment(cardKey, content), dryRunComment);
    },

    async upsertComment(cardKey, title, body) {
      const content = outgoing(`${title}\n\n${body}`);
      const header = stripAutomationMark(content).split("\n")[0];
      const existing = (await source.listComments(cardKey)).find(
        (c) => c.author === user && isAutomationText(c.body) && stripAutomationMark(c.body).split("\n")[0] === header,
      );
      if (!existing) return addOwnComment(cardKey, content, true);
      if (!mesmoTexto(existing.body, content)) await this.editComment(cardKey, existing.id, content);
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
          if (comment.author !== user || !isAutomationText(comment.body))
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

    async dismiss(cardKey, reason) {
      if (!config.dryRun) {
        const card = await source.getCard(cardKey);
        if (card && card.assignee === user && config.statuses[card.status] === "done") return;
      }
      return write(
        { target: cardKey, action: "dismiss", content: reason },
        async () => (source.dismiss ? cardNotOwned(cardKey) : `a Fonte de ${config.name} não dá baixa em cards`),
        () => (source.dismiss as NonNullable<typeof source.dismiss>).call(source, cardKey, reason),
        () => undefined,
      );
    },

    ...efeitosDeCodigo,
  };
}
