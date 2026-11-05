import type {
  ManagementButton,
  ManagementInterface,
  ManagementMessage,
  ManagementUpdate,
} from "../../src/management.js";

/** O chat e o usuário autorizados nos testes (dados fictícios). */
export const TELEGRAM_CHAT = "1001";
export const TELEGRAM_USER = "2002";

/**
 * O Telegram dos testes, em memória: guarda as mensagens que a fábrica publicou e deixa o teste agir como o usuário
 * (ou um estranho) digitando comandos e tocando botões. Devolve só os updates a partir do `offset` pedido.
 */
export class FakeTelegram implements ManagementInterface {
  readonly name = "telegram";
  readonly sent: ManagementMessage[] = [];
  readonly answers: { buttonId: string; text: string }[] = [];
  private updates: ManagementUpdate[] = [];
  private nextId = 1;
  private waiters = new Set<() => void>();
  private failures = 0;

  constructor(private opts: { unreachable?: boolean } = {}) {}

  /** As próximas `n` publicações falham, como numa queda do Telegram. */
  failNextSends(n: number): void {
    this.failures = n;
  }

  async send(message: ManagementMessage): Promise<void> {
    if (this.opts.unreachable) throw new Error("Telegram (fake): chat não encontrado");
    if (this.failures > 0) {
      this.failures--;
      throw new Error("Telegram (fake): fora do ar");
    }
    this.sent.push(JSON.parse(JSON.stringify(message)) as ManagementMessage);
  }

  async receive(offset: number, signal: AbortSignal): Promise<ManagementUpdate[]> {
    for (;;) {
      if (signal.aborted) return [];
      // Guarda o histórico todo (não esquece os confirmados): um `offset` que não sobreviveu a um reinício aparece.
      const pending = this.updates.filter((u) => u.id >= offset);
      if (pending.length > 0) return pending.map((u) => ({ ...u }));
      await new Promise<void>((resolve) => {
        const wake = () => {
          this.waiters.delete(wake);
          signal.removeEventListener("abort", wake);
          resolve();
        };
        this.waiters.add(wake);
        signal.addEventListener("abort", wake, { once: true });
      });
    }
  }

  async answerButton(buttonId: string, text: string): Promise<void> {
    this.answers.push({ buttonId, text });
  }

  /** Simula o Telegram escolhendo uma nova sequência após longa inatividade. */
  resetSequence(nextId = 1): void {
    this.updates = [];
    this.nextId = nextId;
    for (const wake of [...this.waiters]) wake();
  }

  /** Alguém digita `text` no chat (por padrão, o usuário autorizado no chat autorizado). */
  say(text: string, from: { chat?: string; user?: string } = {}): void {
    this.push({ text, chat: from.chat ?? TELEGRAM_CHAT, user: from.user ?? TELEGRAM_USER });
  }

  /** Alguém toca um botão de uma mensagem da fábrica. */
  tap(button: ManagementButton, from: { chat?: string; user?: string } = {}): string {
    const buttonId = `toque-${this.nextId}`;
    this.push({ text: button.command, chat: from.chat ?? TELEGRAM_CHAT, user: from.user ?? TELEGRAM_USER, buttonId });
    return buttonId;
  }

  /** Os textos publicados, na ordem. */
  texts(): string[] {
    return this.sent.map((m) => m.text);
  }

  /** O botão `label` da última mensagem que o tem. */
  button(label: string): ManagementButton {
    const found = this.sent
      .flatMap((m) => m.buttons ?? [])
      .filter((b) => b.label === label)
      .at(-1);
    if (!found) throw new Error(`nenhuma mensagem tem o botão "${label}"`);
    return found;
  }

  private push(update: Omit<ManagementUpdate, "id">): void {
    this.updates.push({ id: this.nextId++, ...update });
    for (const wake of [...this.waiters]) wake();
  }
}
