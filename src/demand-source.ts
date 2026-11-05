/** Um card na Fonte, como a fábrica o enxerga. */
export interface Card {
  key: string;
  title: string;
  /** Nome do status no workflow da Fonte (ex.: "A Fazer"). */
  status: string;
  /** Identificador do responsável na Fonte. */
  assignee: string;
}

/**
 * Porta para o sistema de onde vêm as demandas (Jira, GitLab Issues, GitHub Issues).
 * Cada instância atende um único projeto: o adaptador recebe a config do projeto ao ser criado
 * e aplica o escopo (ex.: `source.project`) na própria consulta à Fonte.
 */
export interface DemandSource {
  /**
   * Cards do projeto configurado atribuídos a `assignee`, em qualquer status.
   * Nunca retorna cards de outros projetos. O filtro por status é da fábrica, não da Fonte.
   */
  listAssignedCards(assignee: string): Promise<Card[]>;
}
