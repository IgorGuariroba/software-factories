/** Tarefa como as ações humanas a enxergam: as conversas de cada etapa e o que elas precisam ler e gravar. */
export interface TarefaAcoes {
  id: string;
  specConversationId?: string | null;
  review?: { conversationId?: string | null } | null;
  retros?: { stage: string; conversationId?: string | null }[];
  conversasEsquecidas?: string[];
}

/** Resposta de um endpoint de ação: status HTTP e corpo. */
export interface RespostaAcao {
  status: number;
  body: unknown;
}

/** Dependências das ações humanas sobre uma Tarefa. */
export interface PortasAcoes {
  /** A Tarefa com esse id, se existir. */
  tarefa(id: string): Promise<TarefaAcoes | undefined>;
  /** Altera a Tarefa numa transação durável. */
  alterar(id: string, fn: (tarefa: TarefaAcoes) => void): Promise<void>;
  /** Prévia do reparo humano: o que mudaria e a revisão que a aprovação precisa devolver. */
  previaReparo(tarefa: TarefaAcoes): Promise<unknown>;
  /** Integra o reparo aprovado, validando a revisão. Lança se a revisão não bate ou a Tarefa mudou. */
  integrarReparo(id: string, revisao: string): Promise<{ ticket: number; sha: string }>;
  /** Registra progresso na Tarefa. */
  registrarProgresso(id: string, mensagem: string): Promise<void>;
}
