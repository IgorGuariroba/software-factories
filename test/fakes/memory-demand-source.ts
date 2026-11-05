import type { Card, CardComment, DemandSource } from "../../src/demand-source.js";

/** Fonte em memória: o "Jira fake" dos testes. Os comentários são escritos como `author`. */
export class MemoryDemandSource implements DemandSource {
  private comments = new Map<string, CardComment[]>();
  private nextId = 1;

  /** Atraso artificial em toda operação, para simular a rede e expor corridas. */
  latencyMs = 0;

  constructor(
    public cards: Card[] = [],
    public author = "igor",
  ) {}

  private async network(): Promise<void> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
  }

  async listAssignedCards(assignee: string): Promise<Card[]> {
    await this.network();
    return this.cards.filter((c) => c.assignee === assignee).map((c) => ({ ...c }));
  }

  async getCard(key: string): Promise<Card | undefined> {
    await this.network();
    const card = this.cards.find((c) => c.key === key);
    return card && { ...card };
  }

  async listComments(key: string): Promise<CardComment[]> {
    await this.network();
    return this.commentsOf(key).map((c) => ({ ...c }));
  }

  async addComment(key: string, body: string): Promise<{ id: string }> {
    await this.network();
    const id = String(this.nextId++);
    this.comments.set(key, [...this.commentsOf(key), { id, author: this.author, body }]);
    return { id };
  }

  async editComment(key: string, commentId: string, body: string): Promise<void> {
    await this.network();
    const comment = this.commentsOf(key).find((c) => c.id === commentId);
    if (!comment) throw new Error(`Comentário ${commentId} não existe em ${key}`);
    comment.body = body;
  }

  async transition(key: string, status: string): Promise<void> {
    await this.network();
    const card = this.cards.find((c) => c.key === key);
    if (!card) throw new Error(`Card ${key} não existe`);
    card.status = status;
  }

  /** Para os testes: comentários do card, simulando também os escritos por pessoas. */
  commentsOf(key: string): CardComment[] {
    return this.comments.get(key) ?? [];
  }

  /** Para os testes: um comentário escrito por outra pessoa. */
  humanComment(key: string, author: string, body: string): CardComment {
    const comment = { id: String(this.nextId++), author, body };
    this.comments.set(key, [...this.commentsOf(key), comment]);
    return comment;
  }
}
