/** Tarefa como o escalonador a enxerga: só os campos que decidem a ordem e os avisos. */
export interface TarefaEscalonador {
  id: string;
  project: string;
  key: string;
  status: string;
  pauseRequested: boolean;
  notBefore: number | null;
  reason: string | null;
}

/** Parte do estado que o escalonador lê. Formato estrutural: o estado da fábrica o satisfaz. */
export interface EstadoEscalonador {
  daemonPaused: boolean;
  tasks: TarefaEscalonador[];
}

/** Evento que o escalonador registra: mudança de status de uma Tarefa, ou uma falha de agendamento. */
export type EventoEscalonador =
  | {
      type: "task";
      project: string;
      id: string;
      key: string;
      status: string;
      reason?: string;
    }
  | { type: "error"; project: string; target: string; message: string };

/**
 * Dependências do escalonador. A decisão de quem roda, quando e em que ordem é dele; a execução (buscar na Fonte,
 * gravar a ativação no estado durável, publicar eventos, esperar um despertar) é da fábrica.
 */
export interface PortasEscalonador {
  /** Uma busca na Fonte: enfileira cards elegíveis e confere respostas. */
  buscar(): Promise<void>;
  estado(): Promise<EstadoEscalonador>;
  agora(): number;
  armTimer(fn: () => void, ms: number): () => void;
  /** Próximo instante em que o projeto aceita atividade (horário do projeto). Só é chamada para projeto configurado. */
  proximaAtividade(projeto: string, agora: number): number;
  projetoConfigurado(projeto: string): boolean;
  pendenciasBloqueantes(projeto: string, estado: EstadoEscalonador): string[];
  repoDesativado(estado: EstadoEscalonador, projeto: string): boolean;
  projetoPausado(estado: EstadoEscalonador, projeto: string): boolean;
  /** Torna a Tarefa ativa no estado durável e abre o que a execução precisa. */
  ativar(id: string): Promise<void>;
  registrarEvento(evento: EventoEscalonador): Promise<void>;
  registrarErro(mensagem: string, erro: unknown): void;
}
