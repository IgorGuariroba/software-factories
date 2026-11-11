import type { ConversationId } from "@earendil-works/pi-durable";
import type { TriageResult } from "../../../triage.js";

/** Registro da triagem de uma Tarefa: o resultado e a decisão da pessoa, se houve uma. */
export interface RegistroTriagem {
  result: TriageResult;
  review: "draft" | "aceitar" | "recusar" | null;
}

/** Tarefa como a triagem a enxerga: só o que a decisão lê e grava. */
export interface TarefaTriagem {
  id: string;
  project: string;
  status: string;
  /** Etapa do pipeline; `triagem` enquanto a issue não foi decidida. */
  stage?: string | null;
  triage?: RegistroTriagem | null;
  triageConversation?: ConversationId | null;
}

/** Parte do estado que a triagem lê e grava. Formato estrutural: o estado da fábrica o satisfaz. */
export interface EstadoTriagem {
  tasks: TarefaTriagem[];
}

/** Motivo de fechamento de uma issue recusada. */
export type MotivoFechamento = "completed" | "not_planned" | "duplicate";

/** Desfecho da triagem para quem chama: o que a Tarefa faz agora. */
export type DesfechoTriagem = "aguardar" | "recusada" | "adiar" | undefined;

/**
 * Dependências da triagem. A triagem decide o que fazer com o resultado; como o resultado é obtido (sinais da Fonte,
 * regras, modelo) fica com a fábrica, pela porta `avaliar`.
 */
export interface PortasTriagem {
  /** Altera o estado na transação da Tarefa. */
  alterar<T>(fn: (estado: EstadoTriagem) => T): Promise<T>;
  /**
   * Configuração de triagem do projeto. `undefined` quando a Fonte não é de repositório monitorado: nada a triar.
   */
  configuracao(projeto: string): { triageApproval: boolean; maxActive: number } | undefined;
  /** Junta os sinais da issue e decide: pelas regras ou, sem decisão, pelo modelo. */
  avaliar(conversa: ConversationId | null): Promise<TriageResult>;
  /** Comenta a recusa e dá baixa na issue. */
  fecharRecusada(projeto: string, chave: string, comentario: string, motivo: MotivoFechamento): Promise<void>;
  /** Aviso ao usuário de que a triagem precisa de decisão na página da Tarefa. */
  avisarDuvida(projeto: string, chave: string, mensagem: string): Promise<void>;
}

/** Tarefa a triar. */
export interface AlvoTriagem {
  id: string;
  project: string;
  key: string;
}
