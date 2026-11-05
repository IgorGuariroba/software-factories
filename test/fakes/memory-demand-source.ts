import type { Card, DemandSource } from "../../src/demand-source.js";

/** Fonte em memória: o "Jira fake" dos testes. */
export class MemoryDemandSource implements DemandSource {
  constructor(public cards: Card[] = []) {}

  async listAssignedCards(assignee: string): Promise<Card[]> {
    return this.cards.filter((c) => c.assignee === assignee).map((c) => ({ ...c }));
  }
}
