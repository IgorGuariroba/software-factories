import type { Channel, QuestionRef } from "../../../channel.js";

/** Pergunta como o módulo a enxerga: só os campos que decidem a conferência e o aviso. */
export interface PerguntaFila {
  n: number;
  origin: "grill" | "card-raso" | "tecnica";
  to: string;
  text: string;
  ref: QuestionRef;
  answer: string | null;
  publication?: "draft" | "sending" | "sent";
  teamsNotice?: { userId: string; link: string; status: "pending" | "attempted" | "sent" | "uncertain" };
}

/** Tarefa com as perguntas que ela levantou. */
export interface TarefaPerguntas {
  id: string;
  project: string;
  key: string;
  title: string;
  status: string;
  pauseRequested: boolean;
  questions?: PerguntaFila[];
}

/** Parte do estado que o módulo lê e grava. Formato estrutural: o estado da fábrica o satisfaz. */
export interface EstadoPerguntas {
  daemonPaused: boolean;
  tasks: TarefaPerguntas[];
}

/** O que o módulo precisa de um projeto: o Canal de conversa, o modo de ensaio, o expediente e a PO. */
export interface ProjetoPerguntas {
  canal: Channel;
  dryRun: boolean;
  /** Chaves de cards que o projeto acompanha; `undefined` quando a Fonte não restringe. */
  chavesDaFonte?: string[];
  /** Próximo instante de atividade do projeto, pelo horário útil dele. */
  proximaAtividade(agora: number): number;
  /** Pessoa do projeto com esse id, se ela é PO; com a identidade dela no Teams, se houver. */
  pessoaPO(id: string): { nome?: string; identidadeTeams?: string } | undefined;
}

export type EventoPergunta =
  | {
      type: "question";
      project: string;
      target: string;
      n: number;
      to: string;
      text: string;
      status: "respondida";
    }
  | { type: "error"; project: string; target: string; message: string };

/**
 * Dependências do módulo de Perguntas. Ele conversa só com a porta de Canal (`ProjetoPerguntas.canal`) e com o canal de
 * avisos; quem grava o estado, registra a resposta e publica eventos é a fábrica.
 */
export interface PortasPerguntas {
  estado(): Promise<EstadoPerguntas>;
  /** Altera o estado numa transação durável. */
  alterar<T>(fn: (state: EstadoPerguntas) => T): Promise<T>;
  agora(): number;
  projeto(nome: string): ProjetoPerguntas | undefined;
  projetoPausado(state: EstadoPerguntas, nome: string): boolean;
  /** A pergunta que a Tarefa aguarda, se houver. */
  perguntaPendente(tarefa: TarefaPerguntas): PerguntaFila | undefined;
  /** Grava a resposta na pergunta e devolve a Tarefa à fila. `false` se a pergunta já tinha resposta. */
  registrarResposta(state: EstadoPerguntas, id: string, n: number, resposta: string): boolean;
  /** Canal de avisos ao Teams. `undefined` quando o Teams não está configurado neste daemon. */
  avisoTeams?: (userId: string, texto: string) => Promise<void>;
  registrarEvento(evento: EventoPergunta): Promise<void>;
}
