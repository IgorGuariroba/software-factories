import type { TelegramContent } from "./config.js";
import type { ManagementProgress, QueuedTask } from "./durable.js";
import type { FactoryEvent } from "./events.js";
import type { ManagementBridgeDeps, ManagementMessage } from "./management-comandos.js";
import {
  avisoJaEnfileirado,
  envelopeMinimoLegado,
  mensagemDoEvento,
  type OrigemAviso,
  podeEnviarAgora,
  proximoDespertar,
  textoDaPergunta,
  textoDoAvisoAdiado,
  textoSpecPronta,
} from "./packages/mensagens-gestao/index.js";
import { redactSecrets } from "./secrets.js";

/** Opções da reconciliação: o modo de conteúdo, o envio automático (que respeita o expediente) e a parada da ponte. */
interface OpcoesReconciliacao {
  content(project: string): TelegramContent;
  automatic(project: string, message: ManagementMessage): Promise<boolean>;
  estaParado(): boolean;
}

/**
 * Reavisa, ao iniciar, as perguntas pendentes e as SPECs em revisão que versões anteriores podem não ter publicado. Para
 * na primeira falha de envio: a próxima rodada tenta de novo.
 */
async function reconciliarTarefas(tarefas: QueuedTask[], opcoes: OpcoesReconciliacao): Promise<void> {
  for (const task of tarefas) {
    if (opcoes.estaParado()) return;
    if (!["aguardando-humano", "pausada"].includes(task.status)) continue;
    const pending = task.questions?.filter((q) => q.answer === null && q.publication !== "sending") ?? [];
    for (const q of pending) {
      const full = opcoes.content(task.project) === "full";
      if (
        !(await opcoes.automatic(task.project, {
          text: textoDaPergunta({
            prefixo: "Pergunta pendente",
            n: q.n,
            chave: task.key,
            projeto: task.project,
            texto: q.text,
            completo: full,
            rascunho: q.publication === "draft",
          }),
          buttons: [{ label: "Responder", command: `/responder ${task.id} ${q.n}` }],
        }))
      )
        return;
    }
    if (pending.length === 0 && task.specReview === "draft") {
      if (
        !(await opcoes.automatic(task.project, {
          text: textoSpecPronta(task.key, task.project),
        }))
      )
        return;
    }
  }
}

/** O que o publicador precisa da ponte: relógio, progresso salvo, envio com novas tentativas e a parada. */
export interface ContextoPublicacao {
  deps: ManagementBridgeDeps;
  events: ManagementBridgeDeps["events"];
  via: string;
  progress: ManagementProgress;
  save(): Promise<void>;
  deliver(message: ManagementMessage, project?: string): Promise<boolean>;
  estaParado(): boolean;
}

export interface Publicador {
  /** Agenda uma rodada de publicação (avisos adiados e eventos pendentes). Não empilha duas ao mesmo tempo. */
  publish(): void;
  /** Reconcilia as pendências atuais ao iniciar: avisos de perguntas e SPECs que versões antigas podem não ter publicado. */
  reconciliarAoIniciar(): void;
  /** Cancela o despertar agendado dos avisos adiados (ao parar). */
  desarmar(): void;
  /** Espera a fila de publicação esvaziar. */
  ociosa(): Promise<void>;
}

/**
 * Publicação dos eventos da fábrica na interface de gestão: a ordem do log, o adiamento por horário de disponibilidade,
 * a regra de duplicata e o cursor durável. A apresentação está no pacote mensagens-gestao; aqui ficam o relógio, o
 * progresso e o envio.
 */
export function criarPublicador(ctx: ContextoPublicacao): Publicador {
  const { deps, events, via, progress, save, deliver } = ctx;
  let publishing: Promise<void> = Promise.resolve();
  let publishPending = false;
  let disarmDeferred: (() => void) | undefined;
  const availableAt = (project: string) => deps.availableAt?.(project) ?? deps.now();

  // Mensagem de cada evento: a apresentação está no pacote mensagens-gestao; o relógio, as tarefas e o modo de conteúdo são daqui.
  async function render(event: FactoryEvent): Promise<ManagementMessage | null> {
    return mensagemDoEvento(event, {
      agora: () => deps.now(),
      tarefas: () => deps.tasks(),
      conteudoCompleto: (projeto) => projeto === undefined || deps.content(projeto) === "full",
    });
  }

  function withContextLabel(project: string, message: ManagementMessage): ManagementMessage {
    const label = deps.contextLabel?.(project);
    if (label && !message.text.startsWith(`[${label}]`)) return { ...message, text: `[${label}] ${message.text}` };
    return message;
  }

  async function resolveDeferred(item: {
    project: string;
    message: ManagementMessage;
    source?: FactoryEvent;
  }): Promise<ManagementMessage> {
    // Qual texto sai é regra do pacote mensagens-gestao; o render e o envelope são daqui.
    const renderizado = item.source ? await render(item.source) : null;
    const escolha = textoDoAvisoAdiado({
      renderizado: renderizado !== null,
      modoMinimo: deps.content(item.project) === "minimal",
    });
    if (escolha === "renderizado" && renderizado) return withContextLabel(item.project, renderizado);
    if (escolha === "envelope-minimo") return envelopeMinimoLegado(item);
    return item.message;
  }

  function wakeDeferred(): void {
    disarmDeferred?.();
    // O próximo despertar é o menor instante de disponibilidade entre os avisos adiados (regra no pacote mensagens-gestao).
    const wakeAt = proximoDespertar(
      (progress.deferred ?? []).map((item) => item.project),
      availableAt,
    );
    if (wakeAt !== undefined && !ctx.estaParado())
      disarmDeferred = deps.armTimer(() => publish(), Math.max(1, wakeAt - deps.now()));
  }

  /** Origem de um aviso adiado, para a regra de duplicata: o evento que o gerou, sem o que não é origem. */
  const origemDo = (source?: FactoryEvent): OrigemAviso | undefined =>
    source
      ? {
          type: source.type,
          at: "at" in source ? source.at : undefined,
          target: "target" in source ? source.target : undefined,
          n: "n" in source ? source.n : undefined,
        }
      : undefined;

  async function automatic(project: string, message: ManagementMessage, source?: FactoryEvent): Promise<boolean> {
    message = withContextLabel(project, message);
    if (availableAt(project) <= deps.now() && (await deliver(message, project))) return true;
    if (ctx.estaParado()) return false;
    progress.deferred ??= [];
    const queue = progress.deferred;
    // A reconciliação no reinício não duplica um lembrete já enfileirado (regra no pacote mensagens-gestao).
    if (!avisoJaEnfileirado(queue, project, message, origemDo(source))) {
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
    if (publishPending || ctx.estaParado()) return;
    publishPending = true;
    publishing = publishing.then(async () => {
      publishPending = false;
      try {
        for (const item of [...(progress.deferred ?? [])]) {
          if (!podeEnviarAgora(item.project, deps.now(), availableAt)) continue;
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
          if (!event || ctx.estaParado()) break;
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
        if (advanced && !ctx.estaParado()) await save();
      } catch (err) {
        if (!ctx.estaParado()) console.error(`[fábrica] ${via}: erro ao publicar eventos:`, err);
      }
    });
  }

  function reconciliarAoIniciar(): void {
    publishing = publishing
      .then(async () => {
        let tasks: QueuedTask[];
        try {
          tasks = await deps.tasks();
        } catch {
          console.error(`[fábrica] ${via}: não foi possível consultar as pendências ao iniciar`);
          return;
        }
        await reconciliarTarefas(tasks, {
          content: deps.content,
          automatic: (project, message) => automatic(project, message),
          estaParado: ctx.estaParado,
        });
      })
      .catch(() => {
        if (!ctx.estaParado()) console.error(`[fábrica] ${via}: erro ao reconciliar pendências`);
      });
  }

  return {
    publish,
    reconciliarAoIniciar,
    desarmar: () => disarmDeferred?.(),
    ociosa: () => publishing,
  };
}
