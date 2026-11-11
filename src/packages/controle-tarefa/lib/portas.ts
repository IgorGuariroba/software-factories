/** Estados em que a Tarefa já terminou: não pausa, não cancela, não muda mais. */
export const TERMINAIS: ReadonlySet<string> = new Set(["concluida", "cancelada", "bloqueada", "vetada", "recusada"]);

/** Motivo de um bloqueio que a retomada sabe destravar: a linha de base, a sincronização da base, ou o TDD recusado. */
export type TipoDeBloqueio = "baseline" | "tdd" | "base-sync" | null;

/** Tarefa como o controle a enxerga: só os campos que pausar, retomar, cancelar e vetar leem e gravam. */
export interface TarefaControle {
  id: string;
  project: string;
  status: string;
  stage?: string | null;
  pauseRequested: boolean;
  durableId: number | null;
  gateId: number | null;
  reason: string | null;
  implementation?: {
    baseline: unknown;
    rejections: number;
    feedback: unknown;
    synchronization?: { status: string; attempts: number } | null;
  } | null;
  veto?: { until: number; expired?: boolean } | null;
}

/** Parte do estado que o controle lê e grava. Formato estrutural: o estado da fábrica o satisfaz. */
export interface EstadoControle {
  daemonPaused: boolean;
  tasks: TarefaControle[];
}

/** Resultado do veto: vale só dentro do prazo. */
export type ResultadoVeto = "vetada" | "fora-do-prazo" | "inexistente";

/** Dependências do controle de Tarefas. */
export interface PortasControle {
  /** Altera o estado numa transação durável; devolve o que a função devolver. */
  alterar<T>(fn: (estado: EstadoControle) => T): Promise<T>;
  /** Aborta a execução durável de uma task (a Tarefa em andamento, ou o portão em que ela espera). */
  abortar(idDurable: number): Promise<void>;
  agora(): number;
  /** Que tipo de bloqueio a Tarefa tem, se a retomada sabe destravá-lo. */
  tipoDeBloqueio(tarefa: TarefaControle): TipoDeBloqueio;
}
