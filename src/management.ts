import type { TelegramContent } from "./config.js";
import type { ManagementProgress, QueuedTask } from "./durable.js";
import type { FactoryEvent, NewEvent } from "./events.js";
import type { FactoryCommands } from "./factory.js";
import { redactSecrets } from "./secrets.js";

/** Um botão sob a mensagem; tocá-lo é o mesmo que enviar `command` (ex.: `/vetar exemplo/PROJ-1`). */
export interface ManagementButton {
  label: string;
  command: string;
}

/** Mensagem da fábrica ao usuário. Texto puro, sem marcação. */
export interface ManagementMessage {
  text: string;
  buttons?: ManagementButton[];
}

/** Algo que o usuário (ou qualquer um) mandou pela interface: um comando digitado ou o toque num botão. */
export interface ManagementUpdate {
  /** Crescente na interface (no Telegram, o `update_id`): a fábrica guarda o próximo para não reprocessar. */
  id: number;
  /** Conversa de onde veio (no Telegram, o id do chat). */
  chat: string;
  /** Quem mandou (no Telegram, o id do usuário). */
  user: string;
  /** O comando digitado, ou o `command` do botão tocado. */
  text: string;
  /** Presente no toque num botão: identifica o toque para `answerButton`. */
  buttonId?: string;
}

/**
 * Porta da Interface de gestão: publicar mensagens ao usuário e receber os comandos dele. Adaptadores: Telegram (Bot
 * API) e, nos testes, um fake em memória. Quem decide o que publicar, quem pode comandar e o que cada comando faz é a
 * fábrica, não o adaptador.
 */
export interface ManagementInterface {
  /** Nome da interface nos eventos e no estado durável (ex.: `telegram`). */
  readonly name: string;
  /**
   * Publica a mensagem na conversa configurada. Rejeita se a interface recusar ou estiver fora do ar; o erro nunca
   * contém credenciais. Texto acima do limite da interface chega truncado; botões que a interface não aceita somem.
   */
  send(message: ManagementMessage, signal?: AbortSignal): Promise<void>;
  /**
   * Espera e devolve os comandos com `id >= offset`, em ordem. Pedir com um `offset` maior confirma os anteriores.
   * Devolve `[]` quando `signal` aborta (ou quando a espera da interface termina sem nada novo).
   */
  receive(offset: number, signal: AbortSignal): Promise<ManagementUpdate[]>;
  /** Responde ao toque num botão (no Telegram, o aviso curto que encerra o "carregando" do botão). */
  answerButton(buttonId: string, text: string, signal?: AbortSignal): Promise<void>;
}

// --- Ponte entre a fábrica e uma interface de gestão ---------------------------------------------

/** Tentativas de publicar uma mensagem antes de descartá-la (com evento `delivery`). */
export const SEND_ATTEMPTS = 3;
/** Espera antes da 2ª e da 3ª tentativa, no relógio da fábrica. */
export const SEND_RETRY_DELAYS_MS = [5_000, 30_000];
/** Espera depois de uma falha ao receber, no relógio da fábrica. */
export const RECEIVE_RETRY_MS = 10_000;

export interface ManagementBridgeDeps {
  port: ManagementInterface;
  /** Conversa autorizada: a única de onde comandos são aceitos (e para onde a porta publica). */
  chat: string;
  /** Usuário autorizado; se informado, comandos de outra pessoa na mesma conversa também são ignorados. */
  user?: string;
  events: {
    list(): FactoryEvent[];
    subscribe(subscriber: (event: FactoryEvent) => void): () => void;
    append(event: NewEvent): Promise<void>;
  };
  /** Eventos que já existiam quando a interface foi ligada pela primeira vez: não são publicados. */
  initialEventCount: number;
  progress: {
    load(): Promise<ManagementProgress | undefined>;
    save(progress: ManagementProgress): Promise<void>;
  };
  tasks(): Promise<QueuedTask[]>;
  commands: FactoryCommands;
  /** Nível de conteúdo do projeto (`telegram.content`). */
  content(project: string): TelegramContent;
  /** Próximo instante permitido para avisos automáticos deste projeto. */
  availableAt?(project: string): number;
  /** Identificação visível do contexto, sem inferir pelo nome do projeto. */
  contextLabel?(project: string): string;
  now(): number;
  /** Timer no relógio da fábrica; devolve como desarmá-lo. */
  armTimer(callback: () => void, delayMs: number): () => void;
}

const HELP = [
  "Comandos:",
  "/vetar <card>: veta a Tarefa dentro do prazo de veto",
  "/pausar [card]: pausa a Tarefa (sem card, o daemon)",
  "/retomar [card]: retoma a Tarefa (sem card, o daemon)",
  "/cancelar <card>: cancela a Tarefa",
  "/responder: escolha uma pergunta e envie sua resposta",
  "/sair: cancela a resposta em andamento",
  "/responder <card> <número> <texto>: registra uma resposta local explícita",
  "<card> é a chave (PROJ-1) ou projeto/chave (exemplo/PROJ-1).",
].join("\n");

/**
 * Liga uma interface de gestão à fábrica: publica os eventos relevantes do log (na ordem, com o progresso durável) e
 * executa os comandos do usuário autorizado, os mesmos da API. Toda mensagem passa pelo filtro de segredos. Uma falha
 * da interface nunca derruba nem trava a fábrica: a mensagem é tentada de novo e, no limite, descartada com evento.
 */
export async function startManagementBridge(deps: ManagementBridgeDeps): Promise<{ stop(): Promise<void> }> {
  const { port, events } = deps;
  const via = port.name;
  const stored = await deps.progress.load();
  const progress: ManagementProgress = {
    eventCursor: stored?.eventCursor ?? deps.initialEventCount,
    deferred: stored?.deferred ?? [],
    answering: stored?.answering ?? {},
    updateOffset: stored?.updateOffset ?? 0,
    lastUpdateAt: stored?.lastUpdateAt ?? deps.now(),
  };
  const save = () => deps.progress.save({ ...progress });
  if (!stored) await save();

  let stopped = false;
  const abort = new AbortController();
  const disarms = new Set<() => void>();
  /** Espera no relógio da fábrica; termina antes se a ponte parar. */
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (stopped) return resolve();
      const done = () => {
        disarms.delete(disarm);
        resolve();
      };
      const disarm = (): void => {
        cancel();
        done();
      };
      const cancel = deps.armTimer(done, ms);
      disarms.add(disarm);
    });

  /** Publica com novas tentativas. `false` se a ponte parou antes de conseguir (a mensagem fica para o reinício). */
  async function deliver(message: ManagementMessage, project?: string): Promise<boolean> {
    const safe: ManagementMessage = {
      text: redactSecrets(message.text),
      ...(message.buttons ? { buttons: message.buttons.map((b) => ({ ...b, label: redactSecrets(b.label) })) } : {}),
    };
    for (let attempt = 1; ; attempt++) {
      if (stopped || (project !== undefined && (deps.availableAt?.(project) ?? deps.now()) > deps.now())) return false;
      try {
        await port.send(safe, abort.signal);
        return true;
      } catch (err) {
        const error = redactSecrets(err instanceof Error ? err.message : String(err));
        if (attempt >= SEND_ATTEMPTS) {
          console.error(`[fábrica] ${via}: mensagem descartada depois de ${attempt} tentativas: ${error}`);
          await events.append({
            type: "delivery",
            via,
            status: "descartada",
            attempts: attempt,
            text: safe.text,
            error,
          });
          return true;
        }
        console.error(`[fábrica] ${via}: falha ao publicar (tentativa ${attempt}), tentando de novo: ${error}`);
        await sleep(SEND_RETRY_DELAYS_MS[attempt - 1] ?? SEND_RETRY_DELAYS_MS.at(-1) ?? 0);
      }
    }
  }

  // --- Publicação dos eventos --------------------------------------------------------------------

  async function render(event: FactoryEvent): Promise<ManagementMessage | null> {
    const project = "project" in event ? event.project : undefined;
    const full = project === undefined || deps.content(project) === "full";
    switch (event.type) {
      case "question": {
        if (event.status !== "enviada") return null;
        return {
          text:
            `Pergunta ${event.n} sobre ${event.target} (${event.project})` +
            (full ? `: ${event.text}` : ". Consulte a interface web local para ver o conteúdo.") +
            "\nToque em Responder para enviar sua resposta.",
          buttons: [{ label: "Responder", command: `/responder ${event.project}/${event.target} ${event.n}` }],
        };
      }
      case "assumed": {
        if (event.waitsVeto) return null;
        const id = `${event.project}/${event.target}`;
        return {
          text: `Assumi o card ${event.target} (${event.project})${full ? `: ${event.title}` : "."}`,
          buttons: [
            { label: "Pausar", command: `/pausar ${id}` },
            { label: "Cancelar", command: `/cancelar ${id}` },
          ],
        };
      }
      case "notify": {
        const id = `${event.project}/${event.target}`;
        const until = event.until ? ` até ${event.until}` : "";
        const text = full
          ? `Aviso: ${event.message}`
          : `Aviso (${event.reason}) no card ${event.target} (${event.project})${until}.`;
        const vetoOpen = event.reason === "aguardando-veto" && event.until && Date.parse(event.until) > deps.now();
        return vetoOpen ? { text, buttons: [{ label: "Vetar", command: `/vetar ${id}` }] } : { text };
      }
      case "retro":
        if (event.status !== "falhou") return null;
        return {
          text: full ? event.message : `A retrô (${event.stage}) do card ${event.target} (${event.project}) desistiu.`,
        };
      case "blocked":
        return {
          text: `Guardrail bloqueou ${event.action} em ${event.target} (${event.project})${full ? `: ${event.reason}` : "."}`,
        };
      case "task":
        if (event.status === "aguardando-humano") {
          // Falha de leitura não pode prender o cursor e bloquear os próximos avisos.
          let tasks: QueuedTask[];
          try {
            tasks = await deps.tasks();
          } catch {
            return {
              text: `A Tarefa ${event.key} (${event.project}) aguarda sua atenção. Consulte a interface web local.`,
            };
          }
          const task = tasks.find((t) => t.id === event.id);
          if (task?.specReview === "draft")
            return {
              text: `SPEC de ${event.key} (${event.project}) pronta para revisão. Consulte a interface web local para revisar e aprovar.`,
            };
        }
        if (event.status === "bloqueada")
          return {
            text: `A Tarefa ${event.key} (${event.project}) está bloqueada${full && event.reason ? `: ${event.reason}` : "."}`,
          };
        if (event.status === "concluida") return { text: `A Tarefa ${event.key} (${event.project}) terminou.` };
        return null;
      default:
        return null;
    }
  }

  let publishing: Promise<void> = Promise.resolve();
  let publishPending = false;
  let disarmDeferred: (() => void) | undefined;
  const availableAt = (project: string) => deps.availableAt?.(project) ?? deps.now();
  function withContextLabel(project: string, message: ManagementMessage): ManagementMessage {
    const label = deps.contextLabel?.(project);
    if (label && !message.text.startsWith(`[${label}]`)) return { ...message, text: `[${label}] ${message.text}` };
    return message;
  }
  /** Filas legadas sem `source`: em minimal, não reenvia o texto full persistido. */
  function legacyMinimalEnvelope(item: { project: string; message: ManagementMessage }): ManagementMessage {
    const labeled = item.message.text.match(/^(\[[^\]]+\]\s*)?/);
    const prefix = labeled?.[1] ?? "";
    const bare = item.message.text.slice(prefix.length);
    const question = /^(Pergunta(?: pendente)? \d+ sobre \S+ \(\S+\))(?::|\.)([\s\S]*)$/.exec(bare);
    if (question) {
      const body = question[2] ?? "";
      const draft = body.includes("Rascunho não enviado")
        ? "\nRascunho não enviado ao PO. Para publicar, revise e aprove na interface web local. /responder registra uma resposta local, sem publicar a pergunta."
        : "";
      const tip = body.includes("Toque em Responder") ? "\nToque em Responder para enviar sua resposta." : "";
      return {
        text: `${prefix}${question[1]}. Consulte a interface web local para ver o conteúdo.${draft}${tip}`,
        ...(item.message.buttons ? { buttons: item.message.buttons } : {}),
      };
    }
    const assumed = /^(Assumi o card \S+ \(\S+\))(?::|\.)([\s\S]*)$/.exec(bare);
    if (assumed) {
      return {
        text: `${prefix}${assumed[1]}.`,
        ...(item.message.buttons ? { buttons: item.message.buttons } : {}),
      };
    }
    const blocked = /^(A Tarefa \S+ \(\S+\) está bloqueada)(?::|\.)([\s\S]*)$/.exec(bare);
    if (blocked) return { text: `${prefix}${blocked[1]}.` };
    const guard = /^(Guardrail bloqueou \S+ em \S+ \(\S+\))(?::|\.)([\s\S]*)$/.exec(bare);
    if (guard) return { text: `${prefix}${guard[1]}.` };
    const aviso = /^Aviso:(.+)$/s.exec(bare);
    if (aviso)
      return {
        text: `${prefix}Aviso (conteúdo oculto) no projeto ${item.project}. Consulte a interface web local para ver o conteúdo.`,
      };
    return {
      text: `${prefix}Aviso do projeto ${item.project}. Consulte a interface web local para ver o conteúdo.`,
      ...(item.message.buttons ? { buttons: item.message.buttons } : {}),
    };
  }
  async function resolveDeferred(item: {
    project: string;
    message: ManagementMessage;
    source?: FactoryEvent;
  }): Promise<ManagementMessage> {
    if (item.source) {
      const rendered = await render(item.source);
      if (rendered) return withContextLabel(item.project, rendered);
    }
    if (deps.content(item.project) === "minimal") return legacyMinimalEnvelope(item);
    return item.message;
  }
  function wakeDeferred(): void {
    disarmDeferred?.();
    const wakeAt = Math.min(...(progress.deferred ?? []).map((item) => availableAt(item.project)));
    if (Number.isFinite(wakeAt) && !stopped) disarmDeferred = deps.armTimer(publish, Math.max(1, wakeAt - deps.now()));
  }
  async function automatic(project: string, message: ManagementMessage, source?: FactoryEvent): Promise<boolean> {
    message = withContextLabel(project, message);
    if (availableAt(project) <= deps.now() && (await deliver(message, project))) return true;
    if (stopped) return false;
    progress.deferred ??= [];
    const queue = progress.deferred;
    // A reconciliação no reinício não duplica um lembrete já enfileirado.
    const fingerprint = source
      ? `${source.type}:${"target" in source ? source.target : ""}:${"n" in source ? source.n : ""}:${"at" in source ? source.at : ""}`
      : message.text;
    if (
      !queue.some((item) => {
        if (item.project !== project) return false;
        if (source && item.source) {
          return (
            item.source.type === source.type &&
            item.source.at === source.at &&
            ("target" in item.source ? item.source.target : undefined) ===
              ("target" in source ? source.target : undefined) &&
            ("n" in item.source ? item.source.n : undefined) === ("n" in source ? source.n : undefined)
          );
        }
        return item.message.text === message.text || (!source && fingerprint === item.message.text);
      })
    ) {
      queue.push({
        project,
        message: { ...message, text: redactSecrets(message.text) },
        ...(source ? { source } : {}),
      });
      await save();
    }
    wakeDeferred();
    return true;
  }
  function publish(): void {
    if (publishPending || stopped) return;
    publishPending = true;
    publishing = publishing.then(async () => {
      publishPending = false;
      try {
        for (const item of [...(progress.deferred ?? [])]) {
          if (availableAt(item.project) > deps.now()) continue;
          const message = await resolveDeferred(item);
          if (!(await deliver(message, item.project))) {
            wakeDeferred();
            return;
          }
          progress.deferred = progress.deferred?.filter((entry) => entry !== item);
          await save();
        }
        wakeDeferred();
        let advanced = false;
        for (;;) {
          const event = events.list()[progress.eventCursor ?? 0];
          if (!event || stopped) break;
          const message = await render(event);
          if (message && !(await ("project" in event ? automatic(event.project, message, event) : deliver(message))))
            break;
          progress.eventCursor = (progress.eventCursor ?? 0) + 1;
          advanced = true;
          if (message) {
            await save();
            advanced = false;
          }
        }
        if (advanced && !stopped) await save();
      } catch (err) {
        if (!stopped) console.error(`[fábrica] ${via}: erro ao publicar eventos:`, err);
      }
    });
  }

  // --- Comandos ------------------------------------------------------------------------------------

  /** Acha a Tarefa por `projeto/chave` ou só pela chave (se for única entre os projetos). */
  async function resolveTask(arg: string): Promise<{ id: string } | { error: string }> {
    const tasks = await deps.tasks();
    if (arg.includes("/")) {
      const task = tasks.find((t) => t.id === arg);
      return task ? { id: task.id } : { error: `Não achei a Tarefa ${arg}.` };
    }
    const matches = tasks.filter((t) => t.key.toUpperCase() === arg.toUpperCase());
    if (matches.length === 0) return { error: `Não achei a Tarefa ${arg}.` };
    if (matches.length > 1)
      return { error: `Há mais de uma Tarefa ${arg}; use projeto/chave: ${matches.map((t) => t.id).join(", ")}.` };
    return { id: (matches[0] as QueuedTask).id };
  }

  const answering = new Map<string, { id: string; n: number; draft?: string }>(
    Object.entries(progress.answering ?? {}),
  );
  const saveDialogue = async () => {
    progress.answering = Object.fromEntries(answering);
    await save();
  };

  type ExecuteResult = { reply: string; registered?: boolean };

  async function execute(text: string): Promise<ExecuteResult> {
    const [head = "", arg] = text.trim().split(/\s+/);
    const command = head.toLowerCase().replace(/@.*$/, "");
    const { commands } = deps;
    if ((command === "/pausar" || command === "/retomar") && !arg) {
      await commands.setDaemonPaused(command === "/pausar");
      return {
        reply: command === "/pausar" ? "Daemon pausado: nenhuma Tarefa nova começa." : "Daemon retomado.",
      };
    }
    if (!["/vetar", "/pausar", "/retomar", "/cancelar", "/responder"].includes(command) || !arg) return { reply: HELP };
    const found = await resolveTask(arg);
    if ("error" in found) return { reply: found.error };
    const { id } = found;
    switch (command) {
      case "/responder": {
        const match = /^\S+\s+\S+\s+(\d+)\s+([\s\S]+)$/.exec(text.trim());
        if (!match) return { reply: HELP };
        const ok = await commands.answerQuestion?.(id, Number(match[1]), match[2] as string);
        return ok
          ? { reply: `Resposta registrada para ${id}, pergunta ${match[1]}.`, registered: true }
          : {
              reply: "Não foi possível responder: confira o número, o texto e se a pergunta ainda está pendente.",
            };
      }
      case "/vetar": {
        const result = await commands.veto(id);
        if (result === "vetada") return { reply: `Tarefa ${id} vetada: ela não age mais no card.` };
        if (result === "inexistente") return { reply: `Não achei a Tarefa ${id}.` };
        return { reply: `A Tarefa ${id} não está aguardando veto (o prazo já passou ou não houve).` };
      }
      case "/pausar":
        await commands.pause(id);
        return { reply: `Pausa pedida para a Tarefa ${id}.` };
      case "/retomar":
        await commands.resume(id);
        return { reply: `Tarefa ${id} retomada.` };
      default:
        await commands.cancel(id);
        return { reply: `Cancelamento pedido para a Tarefa ${id}.` };
    }
  }

  const authorized = (u: ManagementUpdate) => u.chat === deps.chat && (deps.user === undefined || u.user === deps.user);

  async function acknowledge(update: ManagementUpdate, result: string, followUp?: ManagementMessage): Promise<void> {
    if (update.buttonId !== undefined) {
      await port.answerButton(update.buttonId, redactSecrets(result), abort.signal).catch((err) => {
        console.error(`[fábrica] ${via}: falha ao responder ao botão:`, err instanceof Error ? err.message : err);
      });
      if (followUp) await deliver(followUp);
      return;
    }
    await deliver(followUp ?? { text: result });
  }

  async function handle(update: ManagementUpdate): Promise<void> {
    const text = redactSecrets(update.text);
    const origin = { via, chat: update.chat, user: update.user, text };
    if (!authorized(update)) {
      await events.append({ type: "command", ...origin, accepted: false, result: "origem não autorizada; ignorado" });
      return;
    }
    const session = `${update.chat}/${update.user}`;
    const selected = answering.get(session);
    const input = update.text.trim();

    if (input === "/responder") {
      answering.delete(session);
      await saveDialogue();
      const tasks = await deps.tasks();
      const buttons = tasks
        .filter((t) => ["aguardando-humano", "pausada"].includes(t.status))
        .flatMap((t) =>
          (t.questions ?? [])
            .filter((q) => q.answer === null && q.publication !== "sending")
            .map((q) => ({ label: `${t.key} · pergunta ${q.n}`, command: `/responder ${t.id} ${q.n}` })),
        );
      const result = buttons.length ? "Escolha uma pergunta para responder:" : "Não há perguntas pendentes.";
      await events.append({ type: "command", ...origin, accepted: true, result });
      await acknowledge(update, result, { text: result, buttons });
      return;
    }

    const choose = /^\/responder\s+(\S+)\s+(\d+)$/.exec(input);
    if (choose) {
      const found = await resolveTask(choose[1] as string);
      const task = "id" in found ? (await deps.tasks()).find((t) => t.id === found.id) : undefined;
      const q = task?.questions?.find(
        (q) => q.n === Number(choose[2]) && q.answer === null && q.publication !== "sending",
      );
      if (!task || !q || !["aguardando-humano", "pausada"].includes(task.status)) {
        const result = "Essa pergunta não está mais disponível. Use /responder para escolher outra.";
        await events.append({ type: "command", ...origin, accepted: true, result });
        await acknowledge(update, result, { text: result });
        return;
      }
      answering.set(session, { id: task.id, n: q.n });
      await saveDialogue();
      const result = `Envie sua resposta para ${task.key}, pergunta ${q.n}. Ela será registrada localmente, sem publicar na Fonte. Para sair, use /sair.`;
      await events.append({ type: "command", ...origin, accepted: true, result });
      // Ack curto no botão; a instrução de seleção segue como mensagem normal.
      await acknowledge(update, "Envie sua resposta na conversa.", { text: result });
      return;
    }

    if (input === "/sair") {
      answering.delete(session);
      await saveDialogue();
      const result = "Resposta cancelada. Nenhuma alteração foi feita.";
      await events.append({ type: "command", ...origin, accepted: true, result });
      await acknowledge(update, result, { text: result });
      return;
    }

    if (selected && !input.startsWith("/")) {
      selected.draft = update.text;
      await saveDialogue();
      const result = `Confirmar resposta para ${selected.id}, pergunta ${selected.n}?\n\n${update.text}\n\nA resposta fica local, sem publicar na Fonte.`;
      await events.append({ type: "command", ...origin, accepted: true, result });
      await acknowledge(update, result, {
        text: result,
        buttons: [
          { label: "Confirmar resposta", command: "/confirmar-resposta" },
          { label: "Cancelar", command: "/sair" },
        ],
      });
      return;
    }

    if (input === "/confirmar-resposta") {
      if (!selected?.draft) {
        const result = "Não há resposta para confirmar. Use /responder para escolher uma pergunta.";
        await events.append({ type: "command", ...origin, accepted: true, result });
        await acknowledge(update, result, { text: result });
        return;
      }
      const ok = await deps.commands.answerQuestion?.(selected.id, selected.n, selected.draft);
      const result = ok
        ? `Resposta registrada para ${selected.id}, pergunta ${selected.n}.`
        : "Não foi possível responder: confira o número, o texto e se a pergunta ainda está pendente.";
      if (ok) {
        answering.delete(session);
        await saveDialogue();
      }
      await events.append({ type: "command", ...origin, accepted: true, result });
      await acknowledge(update, result, { text: result });
      return;
    }

    const { reply, registered } = await execute(update.text);
    if (registered) {
      answering.delete(session);
      await saveDialogue();
    }
    await events.append({ type: "command", ...origin, accepted: true, result: reply });
    await acknowledge(update, reply);
  }

  async function receiveLoop(): Promise<void> {
    while (!stopped) {
      const resetAfter = 7 * 24 * 60 * 60 * 1000;
      if (via === "telegram" && progress.updateOffset > 0 && deps.now() - (progress.lastUpdateAt ?? 0) >= resetAfter) {
        progress.updateOffset = 0;
        progress.lastUpdateAt = deps.now();
        await save();
      }
      const wake = new AbortController();
      const remaining = resetAfter - (deps.now() - (progress.lastUpdateAt ?? deps.now()));
      const disarmReset =
        via === "telegram" && progress.updateOffset > 0
          ? deps.armTimer(() => wake.abort(), Math.max(0, remaining))
          : () => {};
      let updates: ManagementUpdate[];
      try {
        updates = await port.receive(progress.updateOffset, AbortSignal.any([abort.signal, wake.signal]));
      } catch (err) {
        if (stopped) return;
        console.error(`[fábrica] ${via}: falha ao receber comandos:`, err instanceof Error ? err.message : err);
        await sleep(RECEIVE_RETRY_MS);
        continue;
      } finally {
        disarmReset();
      }
      for (const update of updates) {
        if (stopped) return;
        if (update.id < progress.updateOffset) continue;
        try {
          await handle(update);
        } catch (err) {
          console.error(`[fábrica] ${via}: erro no comando:`, err);
        }
        if (stopped) return;
        // Confirma depois de executar: um reinício no meio repete o comando, e os comandos são idempotentes.
        progress.updateOffset = update.id + 1;
        progress.lastUpdateAt = deps.now();
        await save();
      }
    }
  }

  const unsubscribe = events.subscribe(() => publish());
  // Reconcilia o estado atual: o cursor antigo pode já ter consumido eventos
  // que versões anteriores ainda não sabiam apresentar ao usuário.
  publishing = publishing
    .then(async () => {
      let tasks: QueuedTask[];
      try {
        tasks = await deps.tasks();
      } catch {
        console.error(`[fábrica] ${via}: não foi possível consultar as pendências ao iniciar`);
        return;
      }
      for (const task of tasks) {
        if (stopped) return;
        if (!["aguardando-humano", "pausada"].includes(task.status)) continue;
        const pending = task.questions?.filter((q) => q.answer === null && q.publication !== "sending") ?? [];
        for (const q of pending) {
          const full = deps.content(task.project) === "full";
          if (
            !(await automatic(task.project, {
              text:
                `Pergunta pendente ${q.n} sobre ${task.key} (${task.project})` +
                (full ? `: ${q.text}` : ". Consulte a interface web local para ver o conteúdo.") +
                (q.publication === "draft"
                  ? "\nRascunho não enviado ao PO. Para publicar, revise e aprove na interface web local. /responder registra uma resposta local, sem publicar a pergunta."
                  : "") +
                "\nToque em Responder para enviar sua resposta.",
              buttons: [{ label: "Responder", command: `/responder ${task.id} ${q.n}` }],
            }))
          )
            return;
        }
        if (pending.length === 0 && task.specReview === "draft") {
          if (
            !(await automatic(task.project, {
              text: `SPEC de ${task.key} (${task.project}) pronta para revisão. Consulte a interface web local para revisar e aprovar.`,
            }))
          )
            return;
        }
      }
    })
    .catch(() => {
      if (!stopped) console.error(`[fábrica] ${via}: erro ao reconciliar pendências`);
    });
  publish();
  const receiving = receiveLoop().catch((err) => {
    if (!stopped) console.error(`[fábrica] ${via}: recepção parou:`, err);
  });

  return {
    async stop() {
      stopped = true;
      unsubscribe();
      disarmDeferred?.();
      abort.abort();
      for (const disarm of [...disarms]) disarm();
      await publishing;
      await receiving;
    },
  };
}
