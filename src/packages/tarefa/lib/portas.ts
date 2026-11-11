/** Desfecho da entrega: `revisar` pede nova rodada de revisão com o feedback das pessoas; o resto segue a fila. */
export type DesfechoEntrega = "acompanhar" | "revisar" | undefined;

/** Feedback de uma pessoa na publicação (PR/MR) que a próxima correção precisa levar em conta. */
export interface FeedbackPublicacao {
  id: string;
  body: string;
  author: string;
}

/** Tarefa como a orquestração de revisão e entrega a enxerga: só o que ela lê e grava. */
export interface TarefaEtapa {
  implementation?: {
    commits: { phase: string; ticket: unknown }[];
    verifiedTickets?: { ticket: unknown }[];
    worktree?: string;
  } | null;
  delivery?: { tickets: unknown[] } | null;
  correctionTickets?: unknown[] | null;
  review?: { head: string; summary: string } | null;
  publication?: {
    status: string;
    url?: string;
    number?: number;
    feedbackIds: string[];
    pendingFeedback?: FeedbackPublicacao[];
  } | null;
}

/**
 * Dependências da orquestração de revisão e entrega. O trabalho em si (implementar, revisar, entregar, sincronizar a
 * base) é feito pela fábrica; este módulo decide a ordem, as retomadas, os lotes e o que registrar no progresso.
 */
export interface PortasEtapa {
  /** A Tarefa, como está agora no estado durável. */
  estado(): Promise<TarefaEtapa | undefined>;
  /** Altera a Tarefa numa transação durável. */
  alterar(fn: (tarefa: TarefaEtapa) => void): Promise<void>;
  /** Registra progresso na Tarefa. Com `historico`, não repete nenhuma mensagem já registrada. */
  progresso(mensagem: string, historico?: boolean): Promise<void>;
  /** Roda as correções pendentes (uma passada de implementação). */
  implementar(): Promise<void>;
  /** Sincroniza a base da Tarefa. `true` se houve mudança. */
  sincronizarBase(): Promise<boolean>;
  /** Roda uma revisão com o feedback dado; devolve o veredito (`corrigir`, `aprovado`…), se houver. */
  revisar(feedback: FeedbackPublicacao[]): Promise<string | undefined>;
  /** Está em modo de ensaio? Nesse modo a PR/MR não é consultada no remoto. */
  emEnsaio(): boolean;
  /** Worktree e número da PR/MR da Tarefa, quando ela já tem implementação e publicação. */
  requisicaoDaTarefa(): Promise<{ worktree?: string | null; numero?: number | null } | undefined>;
  /** Situação remota da PR/MR (`open`, `closed`…). */
  consultarRequisicao(worktree: string, numero: number): Promise<string | undefined>;
  /** Roda a entrega: publica a PR/MR. Devolve o desfecho da etapa (`revisar` pede nova rodada de revisão). */
  entregar(): Promise<DesfechoEntrega>;
  /** Mensagem do bloqueio, se o erro é um bloqueio de etapa; `undefined` para os demais erros. */
  mensagemDeBloqueio(erro: unknown): string | undefined;
  /** Remove segredos de um texto antes de registrá-lo. */
  redigir(texto: string): string;
}
