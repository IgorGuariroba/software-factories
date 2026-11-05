/** Um card na Fonte, como a fábrica o enxerga. */
export interface Card {
  key: string;
  title: string;
  /** Nome do status no workflow da Fonte (ex.: "A Fazer"). */
  status: string;
  /** Identificador do responsável na Fonte. */
  assignee: string;
}

/** Um comentário de um card. */
export interface CardComment {
  id: string;
  /** Identificador do autor na Fonte. */
  author: string;
  body: string;
}

/**
 * Porta para o sistema de onde vêm as demandas (Jira, GitLab Issues, GitHub Issues).
 * Cada instância atende um único projeto: o adaptador recebe a config do projeto ao ser criado
 * e aplica o escopo (ex.: `source.project`) na própria consulta à Fonte.
 * As escritas não passam por aqui diretamente: só o escritor de efeitos chama os métodos de escrita.
 */
export interface DemandSource {
  /**
   * Cards do projeto configurado atribuídos a `assignee`, em qualquer status.
   * Nunca retorna cards de outros projetos. O filtro por status é da fábrica, não da Fonte.
   */
  listAssignedCards(assignee: string): Promise<Card[]>;
  /** O card atual, ou `undefined` se não existir no projeto configurado. */
  getCard(key: string): Promise<Card | undefined>;
  listComments(key: string): Promise<CardComment[]>;
  addComment(key: string, body: string): Promise<{ id: string }>;
  editComment(key: string, commentId: string, body: string): Promise<void>;
  /** Move o card para o status de nome `status` no workflow da Fonte. */
  transition(key: string, status: string): Promise<void>;
}
