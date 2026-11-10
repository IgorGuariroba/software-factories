import type { TeamsConversation } from "../../src/teams-conversa.js";

/** Mensagem da conversa, como a fábrica a enxerga. */
export interface FakeTeamsMessage {
  id: string;
  fromMri: string;
  body: string;
  isFromMe: boolean;
}

/**
 * Conversa do Teams em memória: uma conversa por pessoa (MRI). A fábrica envia com `send`; as respostas das pessoas
 * entram com `reply`, como se alguém tivesse respondido no Teams.
 */
export class FakeTeamsConversa implements TeamsConversation {
  readonly enviadas: { userId: string; text: string }[] = [];
  private readonly conversas = new Map<string, FakeTeamsMessage[]>();
  private nextId = 1;
  constructor(private readonly meMri: string) {}

  private conversaDe(userId: string): FakeTeamsMessage[] {
    let lista = this.conversas.get(userId);
    if (!lista) {
      lista = [];
      this.conversas.set(userId, lista);
    }
    return lista;
  }

  async send(userId: string, text: string): Promise<{ conversationId: string; messageId: string }> {
    this.enviadas.push({ userId, text });
    const messageId = String(this.nextId++);
    this.conversaDe(userId).push({ id: messageId, fromMri: this.meMri, body: text, isFromMe: true });
    return { conversationId: `conv-${userId}`, messageId };
  }

  /** Uma resposta de `fromMri` na conversa com `userId`. */
  reply(userId: string, fromMri: string, body: string): void {
    this.conversaDe(userId).push({ id: String(this.nextId++), fromMri, body, isFromMe: false });
  }

  async repliesFrom(conversationId: string, afterMessageId: string, fromMri: string) {
    const userId = conversationId.replace(/^conv-/, "");
    const lista = this.conversaDe(userId);
    const inicio = lista.findIndex((m) => m.id === afterMessageId);
    if (inicio < 0) throw new Error(`mensagem ${afterMessageId} não existe na conversa`);
    return lista
      .slice(inicio + 1)
      .filter((m) => !m.isFromMe && m.fromMri === fromMri)
      .map((m) => ({ id: m.id, body: m.body }));
  }
}
