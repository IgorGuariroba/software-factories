import type { ManagementInterface, ManagementUpdate } from "./management.js";
import { redactSecrets } from "./secrets.js";

/** Limite de caracteres de uma mensagem na Bot API. */
export const TELEGRAM_TEXT_LIMIT = 4096;
/** Limite, em bytes, do `callback_data` de um botão. */
export const TELEGRAM_CALLBACK_DATA_LIMIT = 64;
/** Limite do aviso que responde ao toque num botão. */
const CALLBACK_ANSWER_LIMIT = 200;

/** Falha numa chamada à Bot API. A mensagem traz o método e a descrição do Telegram, nunca o token. */
export class TelegramError extends Error {
  override name = "TelegramError";
}

/** Corta `text` em `limit` caracteres, sem partir um par substituto, marcando o corte com "…". */
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let cut = text.slice(0, limit - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

type TelegramUpdate = {
  update_id: number;
  message?: { chat: { id: number | string }; from?: { id: number | string }; text?: string };
  callback_query?: {
    id: string;
    from: { id: number | string };
    message?: { chat: { id: number | string } };
    data?: string;
  };
};

/**
 * Adaptador do Telegram: Bot API por HTTP, com long polling (`getUpdates`), sem webhook. Publica texto puro (sem
 * `parse_mode`), com os botões numa linha de inline keyboard. O token só aparece na URL das chamadas: nunca em logs,
 * erros ou eventos.
 */
export function createTelegramBot(opts: {
  token: string;
  /** Conversa onde a fábrica publica. */
  chat: string;
  /** Nos testes, uma Bot API falsa. */
  fetch?: typeof fetch;
  /** Padrão: `https://api.telegram.org`. */
  apiBase?: string;
  /** Espera máxima de cada `getUpdates`, em segundos. Padrão: 25. */
  pollSeconds?: number;
  /** Prazo de envio e resposta a botões, em milissegundos. Padrão: 30 segundos. */
  requestTimeoutMs?: number;
  /** Relógio para determinar quando a sequência do Telegram pode mudar. */
  now?: () => number;
}): ManagementInterface {
  const { token, chat } = opts;
  const fetchImpl = opts.fetch ?? fetch;
  const base = opts.apiBase ?? "https://api.telegram.org";
  const pollSeconds = opts.pollSeconds ?? 25;
  const hide = (text: string) => redactSecrets(text.split(token).join("[token]"));
  /**
   * Updates sem comando (foto, alguém entrou no grupo…) não chegam à fábrica, que então não avançaria o `offset`
   * sobre eles: quando um lote só tem desses, o próximo `getUpdates` os confirma por conta própria.
   */
  let skipTo = 0;
  let skipAt = 0;
  let previousOffset = 0;

  async function call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? `${err.message}${err.cause ? ` (${String(err.cause)})` : ""}` : String(err);
      // Erro novo, sem `cause`: a pilha e a causa da falha de rede podem trazer a URL com o token.
      throw new TelegramError(`Telegram ${method}: falha de rede: ${hide(reason)}`);
    }
    const data = (await res.json().catch(() => undefined)) as
      | { ok: boolean; result?: T; description?: string }
      | undefined;
    if (!res.ok || !data?.ok)
      throw new TelegramError(`Telegram ${method}: HTTP ${res.status}: ${hide(data?.description ?? "sem descrição")}`);
    return data.result as T;
  }

  async function boundedCall<T>(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    waitMs = 0,
  ): Promise<T> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), waitMs + (opts.requestTimeoutMs ?? 30_000));
    try {
      return await call<T>(method, body, AbortSignal.any([...(signal ? [signal] : []), deadline.signal]));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: "telegram",

    async send(message, signal) {
      const buttons = (message.buttons ?? []).filter(
        (b) => b.command.length > 0 && Buffer.byteLength(b.command, "utf8") <= TELEGRAM_CALLBACK_DATA_LIMIT,
      );
      await boundedCall(
        "sendMessage",
        {
          chat_id: chat,
          text: truncate(message.text, TELEGRAM_TEXT_LIMIT),
          link_preview_options: { is_disabled: true },
          ...(buttons.length > 0
            ? { reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.label, callback_data: b.command }))] } }
            : {}),
        },
        signal,
      );
    },

    async receive(offset, signal) {
      if (offset < previousOffset || (skipTo > 0 && (opts.now?.() ?? Date.now()) - skipAt >= 7 * 24 * 60 * 60 * 1000))
        skipTo = 0;
      previousOffset = offset;
      if (signal.aborted) return [];
      let updates: TelegramUpdate[];
      try {
        updates = await boundedCall<TelegramUpdate[]>(
          "getUpdates",
          {
            offset: Math.max(offset, skipTo),
            timeout: pollSeconds,
            allowed_updates: ["message", "callback_query"],
          },
          signal,
          pollSeconds * 1000,
        );
      } catch (err) {
        if (signal.aborted) return [];
        throw err;
      }
      const commands: ManagementUpdate[] = [];
      for (const u of updates) {
        if (u.update_id < offset) continue;
        if (u.message?.text !== undefined) {
          commands.push({
            id: u.update_id,
            chat: String(u.message.chat.id),
            user: String(u.message.from?.id ?? ""),
            text: u.message.text,
          });
        } else if (u.callback_query) {
          commands.push({
            id: u.update_id,
            chat: String(u.callback_query.message?.chat.id ?? ""),
            user: String(u.callback_query.from.id),
            text: u.callback_query.data ?? "",
            buttonId: u.callback_query.id,
          });
        }
      }
      const last = updates.at(-1);
      if (commands.length === 0 && last) {
        skipTo = Math.max(skipTo, last.update_id + 1);
        skipAt = opts.now?.() ?? Date.now();
      }
      return commands;
    },

    async answerButton(buttonId, text, signal) {
      await boundedCall(
        "answerCallbackQuery",
        {
          callback_query_id: buttonId,
          text: truncate(text, CALLBACK_ANSWER_LIMIT),
        },
        signal,
      );
    },
  };
}
