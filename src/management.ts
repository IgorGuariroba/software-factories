import type { ManagementProgress } from "./durable.js";
import { criarTratadorDeComandos, type ManagementBridgeDeps, type ManagementMessage } from "./management-comandos.js";
import { criarPublicador } from "./management-publicacao.js";
import { aposFalhaDeEnvio } from "./packages/mensagens-gestao/index.js";
import { redactSecrets } from "./secrets.js";

export type {
  ManagementBridgeDeps,
  ManagementButton,
  ManagementInterface,
  ManagementMessage,
  ManagementUpdate,
} from "./management-comandos.js";

/** Tentativas de publicar uma mensagem antes de descartá-la (com evento `delivery`). */
export const SEND_ATTEMPTS = 3;
/** Espera antes da 2ª e da 3ª tentativa, no relógio da fábrica. */
export const SEND_RETRY_DELAYS_MS = [5_000, 30_000];
/** Espera depois de uma falha ao receber, no relógio da fábrica. */
export { RECEIVE_RETRY_MS } from "./management-comandos.js";

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
        // A política (quantas tentativas, quanto esperar, quando descartar) está no pacote mensagens-gestao.
        const decisao = aposFalhaDeEnvio(attempt, SEND_ATTEMPTS, SEND_RETRY_DELAYS_MS);
        if (decisao.tipo === "descartar") {
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
        await sleep(decisao.ms);
      }
    }
  }

  // Publicação dos eventos e dos avisos adiados: no módulo management-publicacao.
  const publicacao = criarPublicador({
    deps,
    events,
    via,
    progress,
    save,
    deliver,
    estaParado: () => stopped,
  });

  // Comandos (recebimento e tratamento): no módulo management-comandos.
  const comandos = criarTratadorDeComandos({
    port,
    deps,
    events,
    via,
    progress,
    save,
    abort,
    sleep,
    deliver,
    estaParado: () => stopped,
  });

  const unsubscribe = events.subscribe(() => publicacao.publish());
  // Reconcilia o estado atual: o cursor antigo pode já ter consumido eventos
  // que versões anteriores ainda não sabiam apresentar ao usuário.
  publicacao.reconciliarAoIniciar();
  publicacao.publish();
  const receiving = comandos.receiveLoop().catch((err) => {
    if (!stopped) console.error(`[fábrica] ${via}: recepção parou:`, err);
  });

  return {
    async stop() {
      stopped = true;
      unsubscribe();
      publicacao.desarmar();
      abort.abort();
      for (const disarm of [...disarms]) disarm();
      await publicacao.ociosa();
      await receiving;
    },
  };
}
