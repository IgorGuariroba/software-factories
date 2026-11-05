/**
 * A Bot API do Telegram dos testes, atrás de um `fetch` falso: responde nos formatos da API real e é estrita como ela
 * (token, chat, limite de 4096 caracteres no texto e de 64 bytes no `callback_data`), para o adaptador real rodar na CI.
 */
export class FakeBotApi {
  static readonly BASE = "https://api.telegram.test";
  /** Mensagens aceitas pelo `sendMessage`. */
  readonly messages: { chat_id: string; text: string; reply_markup?: unknown }[] = [];
  readonly callbackAnswers: { callback_query_id: string; text?: string }[] = [];
  private updates: Record<string, unknown>[] = [];
  private nextUpdate = 500;
  private waiters = new Set<() => void>();

  constructor(
    readonly token: string,
    readonly chat: string,
  ) {}

  /** O usuário (no chat autorizado, por padrão) digita `text`. */
  userSays(text: string, from: { chat?: string; user?: string } = {}): void {
    const chat = Number(from.chat ?? this.chat);
    this.push({
      message: {
        message_id: this.nextUpdate,
        chat: { id: chat, type: "private" },
        from: { id: Number(from.user ?? chat) },
        text,
      },
    });
  }

  /** O usuário toca um botão cujo `callback_data` é `data`. */
  userTaps(data: string, from: { chat?: string; user?: string } = {}): void {
    const chat = Number(from.chat ?? this.chat);
    this.push({
      callback_query: {
        id: `cb${this.nextUpdate}`,
        from: { id: Number(from.user ?? chat) },
        message: { message_id: 1, chat: { id: chat, type: "private" } },
        data,
      },
    });
  }

  /** Um update que não é comando (ex.: alguém entrou no grupo): o adaptador o confirma sem entregar. */
  otherUpdate(): void {
    this.push({ my_chat_member: { chat: { id: Number(this.chat) } } });
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const match = url.match(/^https:\/\/api\.telegram\.test\/bot([^/]+)\/(\w+)$/);
    if (!match) return reply(404, { ok: false, error_code: 404, description: "Not Found" });
    const [, token, method] = match;
    if (token !== this.token) return reply(401, { ok: false, error_code: 401, description: "Unauthorized" });
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    switch (method) {
      case "sendMessage":
        return this.sendMessage(body);
      case "getUpdates":
        return this.getUpdates(body, init?.signal ?? undefined);
      case "answerCallbackQuery":
        this.callbackAnswers.push(body as { callback_query_id: string; text?: string });
        return reply(200, { ok: true, result: true });
      default:
        return reply(404, { ok: false, error_code: 404, description: "Not Found: method not found" });
    }
  };

  private sendMessage(body: Record<string, unknown>): Response {
    if (String(body.chat_id) !== this.chat)
      return reply(400, { ok: false, error_code: 400, description: "Bad Request: chat not found" });
    const text = String(body.text ?? "");
    if (text.length === 0)
      return reply(400, { ok: false, error_code: 400, description: "Bad Request: message text is empty" });
    if (text.length > 4096)
      return reply(400, { ok: false, error_code: 400, description: "Bad Request: message is too long" });
    if (body.parse_mode !== undefined)
      return reply(400, { ok: false, error_code: 400, description: "Bad Request: parse_mode não esperado no fake" });
    const markup = body.reply_markup as { inline_keyboard?: { text: string; callback_data: string }[][] } | undefined;
    for (const button of markup?.inline_keyboard?.flat() ?? []) {
      if (Buffer.byteLength(button.callback_data, "utf8") > 64 || button.callback_data.length === 0)
        return reply(400, { ok: false, error_code: 400, description: "Bad Request: BUTTON_DATA_INVALID" });
    }
    this.messages.push({ chat_id: String(body.chat_id), text, reply_markup: body.reply_markup });
    return reply(200, {
      ok: true,
      result: { message_id: this.messages.length, chat: { id: Number(this.chat) }, text },
    });
  }

  private async getUpdates(body: Record<string, unknown>, signal: AbortSignal | undefined): Promise<Response> {
    const offset = Number(body.offset ?? 0);
    // Como o Telegram: pedir com um offset confirma (e esquece) os updates anteriores.
    this.updates = this.updates.filter((u) => Number(u.update_id) >= offset);
    if (this.updates.length === 0) {
      const timeoutMs = Number(body.timeout ?? 0) * 1000;
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          clearTimeout(timer);
          this.waiters.delete(done);
          signal?.removeEventListener("abort", aborted);
          resolve();
        };
        const aborted = () => {
          done();
          reject(new DOMException("This operation was aborted", "AbortError"));
        };
        const timer = setTimeout(done, timeoutMs);
        this.waiters.add(done);
        signal?.addEventListener("abort", aborted, { once: true });
      });
    }
    return reply(200, { ok: true, result: this.updates.filter((u) => Number(u.update_id) >= offset) });
  }

  private push(update: Record<string, unknown>): void {
    this.updates.push({ update_id: this.nextUpdate++, ...update });
    for (const wake of [...this.waiters]) wake();
  }
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
