import type { CodeHost } from "./code-host.js";
import { type CardState, type ProjectConfig, STATE_ORDER } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import type { EventRecorder } from "./events.js";
import { privateTerms, sanitizePublicText } from "./public-text.js";
import type { RetroSink } from "./retro-sink.js";
import { redactSecrets } from "./secrets.js";

/** Marca de automação: vai no fim de todo texto que a fábrica escreve, depois de uma linha em branco. */
export const AUTOMATION_MARK = "*mensagem automatizada*";
const MARK_SUFFIX = `\n\n${AUTOMATION_MARK}`;
/** Prefixos usados antes; reconhecidos para não duplicar nem tratar como humano o que a fábrica já escreveu. */
const LEGACY_PREFIXES = ["\u{1F916} [mensagem automatizada]", "\u{1F916} [fábrica]"];

/** Se o texto foi escrito pela fábrica (marca atual no fim ou prefixo antigo). */
export function isAutomationText(body: string): boolean {
  return body.trimEnd().endsWith(AUTOMATION_MARK) || LEGACY_PREFIXES.some((p) => body.startsWith(p));
}

/** O texto sem a marca de automação (atual ou antiga): o que a fábrica quis dizer. */
export function stripAutomationMark(body: string): string {
  const legacy = LEGACY_PREFIXES.find((p) => body.startsWith(p));
  if (legacy) return body.slice(legacy.length).replace(/^ /, "");
  const trimmed = body.trimEnd();
  return trimmed.endsWith(AUTOMATION_MARK) ? trimmed.slice(0, -AUTOMATION_MARK.length).trimEnd() : body;
}

/** O texto com a marca de automação no fim. */
export function withAutomationMark(body: string): string {
  return `${body}${MARK_SUFFIX}`;
}

/** Uma escrita recusada por guardrail. Nunca chega à Fonte. */
export class GuardrailViolation extends Error {
  override name = "GuardrailViolation";
}

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
export const PROTECTED_BRANCHES: ReadonlySet<string> = new Set(["main", "master", "develop"]);

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
  /** Issues da fábrica: a porta e o único repositório em que ela escreve. */
  retro?: { sink?: RetroSink; repo?: string };
}): EffectWriter {
  const { config, source, events } = opts;
  const user = config.source.assignee;
  const dryRunIds = new Set<string>();

  /**
   * Se o dry-run já registrou esta escrita (mesmo destino, ação e conteúdo). O log de eventos é durável, então a
   * lembrança sobrevive a um reinício: no dry-run nada chega ao sistema, e é só por ela que uma escrita idempotente
   * repetida (ex.: um passo refeito depois de um reinício) não aparece de novo.
   */
  const dryRunRegistered = (w: { target: string; action: string; content: string }) =>
    events
      .list()
      .some(
        (e) =>
          e.type === "write" &&
          e.dryRun &&
          e.project === config.name &&
          e.target === w.target &&
          e.action === w.action &&
          e.content === w.content,
      );

  /**
   * Aplica os guardrails, registra e executa (ou só registra, no dry-run). Com `once` (escritas idempotentes: todas
   * menos `comment`), o dry-run não registra de novo uma escrita que já registrou.
   */
  async function write<T>(
    w: { target: string; action: string; content: string },
    check: () => Promise<string | undefined>,
    run: () => Promise<T>,
    dry: () => T,
    once = true,
  ): Promise<T> {
    const reason = await check();
    if (reason) {
      await events.append({ type: "blocked", project: config.name, ...w, reason });
      throw new GuardrailViolation(`Guardrail: ${w.action} em ${w.target} bloqueado: ${reason}`);
    }
    if (config.dryRun && once && dryRunRegistered(w)) return dry();
    await events.append({ type: "write", project: config.name, ...w, dryRun: config.dryRun });
    return config.dryRun ? dry() : run();
  }

  /** Id fictício de um comentário do dry-run, que `editComment` aceita sem procurar na Fonte. */
  const dryRunComment = () => {
    const id = `dry-run-${dryRunIds.size + 1}`;
    dryRunIds.add(id);
    return { id };
  };

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
  /** Texto que vai ao repositório público: sem segredos e saneado dos valores do projeto e do card. */
  async function publicText(cardKey: string, raw: string) {
    const card = await source.getCard(cardKey);
    return sanitizePublicText(redactSecrets(raw), {
      terms: privateTerms(config, [cardKey, card?.title ?? ""]),
      cardPrefix: config.source.project,
    });
  }
  const retroSink = (): RetroSink => {
    const sink = opts.retro?.sink;
    if (!sink) throw new Error("RetroSink não configurado");
    return sink;
  };
  function retroRefused(repo: string, leftovers: string[]): string | undefined {
    const target = opts.retro?.repo;
    if (!opts.retro?.sink || !target) return "nenhum repositório da fábrica configurado (FACTORY_RETRO_REPO)";
    if (repo !== target) return `o RetroSink só escreve no repositório da fábrica (${target}), não em ${repo}`;
    if (leftovers.length > 0) return `o texto público ainda cita valores do projeto: ${leftovers.join(", ")}`;
    return undefined;
  }

  const statusFor = (state: CardState) => Object.entries(config.statuses).find(([, s]) => s === state)?.[0];

  return {
    async publicRetroText(cardKey, text) {
      return (await publicText(cardKey, text)).text;
    },
    publicRetroPreview: publicText,
    comment(cardKey, body) {
      return addOwnComment(cardKey, body, false);
    },

    async commentOnce(cardKey, body) {
      if (!config.dryRun) {
        const content = outgoing(body);
        const existing = (await source.listComments(cardKey)).find(
          (c) => c.author === user && withAutomationMark(stripAutomationMark(c.body)) === content,
        );
        if (existing) return { id: existing.id };
      }
      return addOwnComment(cardKey, body, true);
    },

    async mention(cardKey, personId, body) {
      // Sem o token de menção: o acli grava texto puro e o Jira o mostraria literalmente. O aviso vai pelo Teams.
      const content = outgoing(body);
      if (!config.dryRun) {
        const existing = (await source.listComments(cardKey)).find(
          (c) => c.author === user && withAutomationMark(stripAutomationMark(c.body)) === content,
        );
        if (existing) return { id: existing.id };
      }
      return write(
        { target: cardKey, action: "mention", content },
        async () => {
          if (!config.people.some((p) => p.id === personId))
            return `${personId} não está entre as pessoas do projeto ${config.name}`;
          return cardNotOwned(cardKey);
        },
        () => source.addComment(cardKey, content),
        dryRunComment,
      );
    },

    async upsertComment(cardKey, title, body) {
      const content = outgoing(`${title}\n\n${body}`);
      const header = stripAutomationMark(content).split("\n")[0];
      const existing = (await source.listComments(cardKey)).find(
        (c) => c.author === user && isAutomationText(c.body) && stripAutomationMark(c.body).split("\n")[0] === header,
      );
      if (!existing) return addOwnComment(cardKey, content, true);
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

    async openRetroIssue(cardKey, repo, issue) {
      const title = await publicText(cardKey, issue.title);
      const body = await publicText(cardKey, issue.body);
      const content = withAutomationMark(body.text);
      return write<{ number: number; url: string } | undefined>(
        { target: `${cardKey}#retro`, action: "retro-issue", content: `${repo}: ${title.text}\n\n${content}` },
        async () => retroRefused(repo, [...title.leftovers, ...body.leftovers]),
        () => retroSink().create(repo, { title: title.text, body: content }),
        () => undefined,
      );
    },

    async commentRetroIssue(cardKey, repo, issue, raw) {
      const body = await publicText(cardKey, raw);
      const content = withAutomationMark(body.text);
      return write(
        { target: `${cardKey}#retro`, action: "retro-comment", content: `${repo}#${issue}: ${content}` },
        async () => retroRefused(repo, body.leftovers),
        () => retroSink().comment(repo, issue, content),
        () => undefined,
      );
    },
  };
}
