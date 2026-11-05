/** Um card na Fonte, como a fábrica o enxerga. */
export interface Card {
  key: string;
  title: string;
  /** Nome do status no workflow da Fonte (ex.: "A Fazer"). */
  status: string;
  /** Identificador do responsável na Fonte. */
  assignee: string;
}

/** Porta para o sistema de onde vêm as demandas (Jira, GitLab Issues, GitHub Issues). */
export interface DemandSource {
  /** Cards atribuídos a `assignee`, em qualquer status. */
  listAssignedCards(assignee: string): Promise<Card[]>;
}
