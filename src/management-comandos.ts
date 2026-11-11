import type { TelegramContent } from "./config.js";
import type { ManagementProgress, QueuedTask } from "./durable.js";
import type { FactoryEvent, NewEvent } from "./events.js";
import type { FactoryCommands } from "./factory.js";
import {
  cursorDepois,
  deveZerarCursor,
  esperaAteZerarCursor,
  interpretarComando,
  jaTratada,
  resolverTarefa,
  respostaDaPergunta,
} from "./packages/comandos-gestao/index.js";
import { redactSecrets } from "./secrets.js";

/** Um botão sob a mensagem; tocá-lo é o mesmo que enviar `command` (ex.: `/vetar exemplo/PROJ-1`). */

export const RECEIVE_RETRY_MS = 10_000;

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

/** O que a ponte precisa para receber e tratar os comandos (ver `startManagementBridge`). */
export interface ContextoComandos {
  port: ManagementInterface;
  deps: ManagementBridgeDeps;
  events: ManagementBridgeDeps["events"];
  via: string;
  progress: ManagementProgress;
  save: () => Promise<void>;
  abort: AbortController;
  sleep: (ms: number) => Promise<void>;
  deliver: (message: ManagementMessage, project?: string) => Promise<boolean>;
  /** A ponte parou? Lido no momento de cada passo, porque a parada pode acontecer a qualquer hora. */
  estaParado: () => boolean;
}

/**
 * Recebimento e tratamento dos comandos da gestão: lê as atualizações, executa cada comando e confirma o cursor depois.
 */
/** Resposta a um comando de gestão: o texto ao usuário, e se o comando registrou uma resposta. */
type ExecuteResult = { reply: string; registered?: boolean };

/** Ação sobre uma Tarefa já resolvida: responder, vetar, pausar, retomar ou cancelar, com a resposta ao usuário. */
async function acaoSobreTarefa(
  comando: string,
  id: string,
  text: string,
  commands: FactoryCommands,
): Promise<ExecuteResult> {
  switch (comando) {
    case "/responder": {
      const resposta = respostaDaPergunta(text);
      if (!resposta) return { reply: HELP };
      const ok = await commands.answerQuestion?.(id, resposta.n, resposta.texto);
      return ok
        ? { reply: `Resposta registrada para ${id}, pergunta ${resposta.n}.`, registered: true }
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

export function criarTratadorDeComandos(f: ContextoComandos) {
  const { port, deps, events, via, progress, save, abort, sleep, deliver } = f;
  // --- Comandos ------------------------------------------------------------------------------------

  /** Acha a Tarefa por `projeto/chave` ou só pela chave (se for única entre os projetos). */
  // Referência da Tarefa (id ou chave): a regra está no pacote comandos-gestao; as tarefas vêm daqui.
  async function resolveTask(arg: string): Promise<{ id: string } | { error: string }> {
    const found = resolverTarefa(await deps.tasks(), arg);
    return "erro" in found ? { error: found.erro } : found;
  }

  const answering = new Map<string, { id: string; n: number; draft?: string }>(
    Object.entries(progress.answering ?? {}),
  );
  const saveDialogue = async () => {
    progress.answering = Object.fromEntries(answering);
    await save();
  };

  async function execute(text: string): Promise<ExecuteResult> {
    const comando = interpretarComando(text);
    const { commands } = deps;
    if (comando.tipo === "pausa-daemon") {
      await commands.setDaemonPaused(comando.pausar);
      return { reply: comando.pausar ? "Daemon pausado: nenhuma Tarefa nova começa." : "Daemon retomado." };
    }
    if (comando.tipo === "ajuda") return { reply: HELP };
    const found = await resolveTask(comando.referencia);
    if ("error" in found) return { reply: found.error };
    const { id } = found;
    return acaoSobreTarefa(comando.comando, id, text, commands);
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

  /**
   * Máquina de diálogo da resposta a uma pergunta: escolher a pergunta, enviar o rascunho, confirmar ou sair. Devolve `true`
   * quando tratou a mensagem; `false` deixa o comando seguir para a execução normal.
   */
  async function tratarDialogo(
    update: ManagementUpdate,
    session: string,
    input: string,
    selected: { id: string; n: number; draft?: string } | undefined,
    responder: (resultado: string, opcoes?: { ack?: string; buttons?: ManagementButton[] }) => Promise<void>,
  ): Promise<boolean> {
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
      await responder(buttons.length ? "Escolha uma pergunta para responder:" : "Não há perguntas pendentes.", {
        buttons,
      });
      return true;
    }

    const choose = /^\/responder\s+(\S+)\s+(\d+)$/.exec(input);
    if (choose) {
      const found = await resolveTask(choose[1] as string);
      const task = "id" in found ? (await deps.tasks()).find((t) => t.id === found.id) : undefined;
      const q = task?.questions?.find(
        (q) => q.n === Number(choose[2]) && q.answer === null && q.publication !== "sending",
      );
      if (!task || !q || !["aguardando-humano", "pausada"].includes(task.status)) {
        await responder("Essa pergunta não está mais disponível. Use /responder para escolher outra.");
        return true;
      }
      answering.set(session, { id: task.id, n: q.n });
      await saveDialogue();
      const result = `Envie sua resposta para ${task.key}, pergunta ${q.n}. Ela será registrada localmente, sem publicar na Fonte. Para sair, use /sair.`;
      // Ack curto no botão; a instrução de seleção segue como mensagem normal.
      await responder(result, { ack: "Envie sua resposta na conversa." });
      return true;
    }

    if (input === "/sair") {
      answering.delete(session);
      await saveDialogue();
      await responder("Resposta cancelada. Nenhuma alteração foi feita.");
      return true;
    }

    if (selected && !input.startsWith("/")) {
      selected.draft = update.text;
      await saveDialogue();
      const result = `Confirmar resposta para ${selected.id}, pergunta ${selected.n}?\n\n${update.text}\n\nA resposta fica local, sem publicar na Fonte.`;
      await responder(result, {
        buttons: [
          { label: "Confirmar resposta", command: "/confirmar-resposta" },
          { label: "Cancelar", command: "/sair" },
        ],
      });
      return true;
    }

    if (input === "/confirmar-resposta") {
      if (!selected?.draft) {
        await responder("Não há resposta para confirmar. Use /responder para escolher uma pergunta.");
        return true;
      }
      const ok = await deps.commands.answerQuestion?.(selected.id, selected.n, selected.draft);
      const result = ok
        ? `Resposta registrada para ${selected.id}, pergunta ${selected.n}.`
        : "Não foi possível responder: confira o número, o texto e se a pergunta ainda está pendente.";
      if (ok) {
        answering.delete(session);
        await saveDialogue();
      }
      await responder(result);
      return true;
    }
    return false;
  }

  async function handle(update: ManagementUpdate): Promise<void> {
    const text = redactSecrets(update.text);
    const origin = { via, chat: update.chat, user: update.user, text };
    /** Registra o comando na atividade: aceito ou recusado, com o resultado que o usuário recebeu. */
    const registrarComando = (aceito: boolean, resultado: string) =>
      events.append({ type: "command", ...origin, accepted: aceito, result: resultado });
    /** Comando aceito: registra o que o usuário recebe e responde no mesmo texto (ou no ack e botões dados). */
    const responder = async (
      resultado: string,
      opcoes: { ack?: string; buttons?: ManagementButton[] } = {},
    ): Promise<void> => {
      await registrarComando(true, resultado);
      await acknowledge(update, opcoes.ack ?? resultado, {
        text: resultado,
        ...(opcoes.buttons !== undefined ? { buttons: opcoes.buttons } : {}),
      });
    };
    if (!authorized(update)) {
      registrarComando(false, "origem não autorizada; ignorado");
      return;
    }
    const session = `${update.chat}/${update.user}`;
    const selected = answering.get(session);
    const input = update.text.trim();

    if (await tratarDialogo(update, session, input, selected, responder)) return;

    const { reply, registered } = await execute(update.text);
    if (registered) {
      answering.delete(session);
      await saveDialogue();
    }
    registrarComando(true, reply);
    await acknowledge(update, reply);
  }

  async function receiveLoop(): Promise<void> {
    while (!f.estaParado()) {
      // Janela de silêncio e cursor: as regras estão no pacote comandos-gestao.
      if (
        deveZerarCursor({
          via,
          cursor: progress.updateOffset,
          ultimaAtualizacao: progress.lastUpdateAt,
          agora: deps.now(),
        })
      ) {
        progress.updateOffset = 0;
        progress.lastUpdateAt = deps.now();
        await save();
      }
      const wake = new AbortController();
      const disarmReset =
        via === "telegram" && progress.updateOffset > 0
          ? deps.armTimer(() => wake.abort(), esperaAteZerarCursor(progress.lastUpdateAt, deps.now()))
          : () => {};
      let updates: ManagementUpdate[];
      try {
        updates = await port.receive(progress.updateOffset, AbortSignal.any([abort.signal, wake.signal]));
      } catch (err) {
        if (f.estaParado()) return;
        console.error(`[fábrica] ${via}: falha ao receber comandos:`, err instanceof Error ? err.message : err);
        await sleep(RECEIVE_RETRY_MS);
        continue;
      } finally {
        disarmReset();
      }
      for (const update of updates) {
        if (f.estaParado()) return;
        if (jaTratada(update.id, progress.updateOffset)) continue;
        try {
          await handle(update);
        } catch (err) {
          console.error(`[fábrica] ${via}: erro no comando:`, err);
        }
        if (f.estaParado()) return;
        // Confirma depois de executar: um reinício no meio repete o comando, e os comandos são idempotentes.
        progress.updateOffset = cursorDepois(update.id);
        progress.lastUpdateAt = deps.now();
        await save();
      }
    }
  }

  return { receiveLoop };
}
