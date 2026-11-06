/** Um card na Fonte, como a fábrica o enxerga. */
export interface Card {
  key: string;
  title: string;
  /** Nome do status no workflow da Fonte (ex.: "A Fazer"). */
  status: string;
  /** Identificador do responsável na Fonte. */
  assignee: string;
  /** Descrição do card, em texto. */
  description?: string;
}

/** Um anexo de texto de um card (ex.: .txt, .md, .csv), já com o conteúdo lido. */
export interface TextAttachment {
  name: string;
  content: string;
}

/** Um comentário de um card. */
export interface CardComment {
  id: string;
  /** Identificador do autor na Fonte. */
  author: string;
  body: string;
}

/** Um PR que cita a issue (Fonte GitHub). */
export interface LinkedPullRequest {
  number: number;
  state: "open" | "merged" | "closed";
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
  /** Anexos de texto do card. Anexos binários (imagens, PDFs) ficam de fora. */
  listTextAttachments(key: string): Promise<TextAttachment[]>;
  addComment(key: string, body: string): Promise<{ id: string }>;
  editComment(key: string, commentId: string, body: string): Promise<void>;
  /** Move o card para o status de nome `status` no workflow da Fonte. */
  transition(key: string, status: string): Promise<void>;
  /** Formata o identificador de uma pessoa para menção no corpo de um comentário nesta Fonte. */
  formatMention(personId: string): string;
  /** PRs que citam o card. Só nas Fontes que têm PRs (GitHub); a triagem usa como sinal de trabalho existente. */
  linkedPullRequests?(key: string): Promise<LinkedPullRequest[]>;
  /**
   * Dá baixa no card recusado na triagem: fecha com o motivo (`completed`, `not_planned`, `duplicate`). Só nas
   * Fontes com triagem (GitHub).
   */
  dismiss?(key: string, reason: "completed" | "not_planned" | "duplicate"): Promise<void>;
}
