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
  "/responder <card> <número> <texto>: responde uma pergunta sem publicar na Fonte",
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
  async function deliver(message: ManagementMessage): Promise<boolean> {
    const safe: ManagementMessage = {
      text: redactSecrets(message.text),
      ...(message.buttons ? { buttons: message.buttons.map((b) => ({ ...b, label: redactSecrets(b.label) })) } : {}),
    };
    for (let attempt = 1; ; attempt++) {
      if (stopped) return false;
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
            `\nPara responder: /responder ${event.project}/${event.target} ${event.n} <texto>`,
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
  function publish(): void {
    if (publishPending || stopped) return;
    publishPending = true;
    publishing = publishing.then(async () => {
      publishPending = false;
      try {
        let advanced = false;
        for (;;) {
          const event = events.list()[progress.eventCursor ?? 0];
          if (!event || stopped) break;
          const message = await render(event);
          if (message && !(await deliver(message))) break;
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

  async function execute(text: string): Promise<string> {
    const [head = "", arg] = text.trim().split(/\s+/);
    const command = head.toLowerCase().replace(/@.*$/, "");
    const { commands } = deps;
    if ((command === "/pausar" || command === "/retomar") && !arg) {
      await commands.setDaemonPaused(command === "/pausar");
      return command === "/pausar" ? "Daemon pausado: nenhuma Tarefa nova começa." : "Daemon retomado.";
    }
    if (!["/vetar", "/pausar", "/retomar", "/cancelar", "/responder"].includes(command) || !arg) return HELP;
    const found = await resolveTask(arg);
    if ("error" in found) return found.error;
    const { id } = found;
    switch (command) {
      case "/responder": {
        const match = /^\S+\s+\S+\s+(\d+)\s+([\s\S]+)$/.exec(text.trim());
        if (!match) return HELP;
        const ok = await commands.answerQuestion?.(id, Number(match[1]), match[2] as string);
        return ok
          ? `Resposta registrada para ${id}, pergunta ${match[1]}.`
          : "Não foi possível responder: confira o número, o texto e se a pergunta ainda está pendente.";
      }
      case "/vetar": {
        const result = await commands.veto(id);
        if (result === "vetada") return `Tarefa ${id} vetada: ela não age mais no card.`;
        if (result === "inexistente") return `Não achei a Tarefa ${id}.`;
        return `A Tarefa ${id} não está aguardando veto (o prazo já passou ou não houve).`;
      }
      case "/pausar":
        await commands.pause(id);
        return `Pausa pedida para a Tarefa ${id}.`;
      case "/retomar":
        await commands.resume(id);
        return `Tarefa ${id} retomada.`;
      default:
        await commands.cancel(id);
        return `Cancelamento pedido para a Tarefa ${id}.`;
    }
  }

  const authorized = (u: ManagementUpdate) => u.chat === deps.chat && (deps.user === undefined || u.user === deps.user);

  async function handle(update: ManagementUpdate): Promise<void> {
    const text = redactSecrets(update.text);
    const origin = { via, chat: update.chat, user: update.user, text };
    if (!authorized(update)) {
      await events.append({ type: "command", ...origin, accepted: false, result: "origem não autorizada; ignorado" });
      return;
    }
    const reply = await execute(update.text);
    await events.append({ type: "command", ...origin, accepted: true, result: reply });
    if (update.buttonId !== undefined) {
      await port.answerButton(update.buttonId, redactSecrets(reply), abort.signal).catch((err) => {
        console.error(`[fábrica] ${via}: falha ao responder ao botão:`, err instanceof Error ? err.message : err);
      });
    } else {
      await deliver({ text: reply });
    }
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
  publish();
  const receiving = receiveLoop().catch((err) => {
    if (!stopped) console.error(`[fábrica] ${via}: recepção parou:`, err);
  });

  return {
    async stop() {
      stopped = true;
      unsubscribe();
      abort.abort();
      for (const disarm of [...disarms]) disarm();
      await publishing;
      await receiving;
    },
  };
}
