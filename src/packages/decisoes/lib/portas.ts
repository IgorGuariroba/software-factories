import type { Channel, QuestionRef } from "../../../channel.js";
import type { ProjectConfig } from "../../../config.js";
import type { EffectWriter } from "../../../effect-writer.js";
import type { SpecDelivery } from "../../../spec-stage.js";
import type { TriageResult } from "../../../triage.js";

/** Resposta de um endpoint de decisão: status HTTP e corpo. Estrutural: a API local a satisfaz. */
export interface RespostaDecisao {
  status: number;
  body: unknown;
}

/** Pergunta como o módulo a enxerga: só os campos que as decisões leem e gravam. */
export interface PerguntaDecisoes {
  n: number;
  origin: "grill" | "card-raso" | "tecnica";
  to: string;
  text: string;
  ref: QuestionRef;
  answer: string | null;
  publication?: "draft" | "sending" | "sent";
  reminder?: "draft" | "sending" | "sent";
  askedAt?: number;
  remindAt?: number;
  notifyAt?: number;
  teamsNotice?: { userId: string; link: string; status: "pending" | "attempted" | "sent" | "uncertain" };
}

/** Tarefa como o módulo a enxerga. */
export interface TarefaDecisoes {
  id: string;
  project: string;
  key: string;
  title: string;
  status: string;
  pauseRequested: boolean;
  triage?: { review: "draft" | "aceitar" | "recusar" | null; result: TriageResult } | null;
  delivery?: { spec: string; tickets: SpecDelivery["tickets"] } | null;
  specReview?: "draft" | "approved" | string;
  specApprovedDryRun?: boolean;
  questions?: PerguntaDecisoes[];
  /** Referência da Tarefa no repositório (branch/ref), usada na issue de retrô. */
  ref?: string | null;
  retros?: RetroDecisoes[];
}

/** Proposta de retrô como o módulo a enxerga: só o que a revisão e a publicação leem. */
export interface PropostaDecisoes {
  n: number;
  kind: string;
  title: string;
  description: string;
  status: string;
  issue: { number: number; url: string } | null;
  reason: string | null;
}

export interface RetroDecisoes {
  stage: string;
  status: string;
  proposals?: PropostaDecisoes[];
}

/** Publicação de uma proposta de retrô: o escritor revisa o texto, o adaptador publica. `sink` é opaco aqui. */
export interface PublicacaoRetro {
  writer: EffectWriter;
  cardKey: string;
  config: ProjectConfig;
  sink: unknown;
  repo: string;
  stage: string;
  ref: string;
  proposal: PropostaDecisoes;
}

/** Texto revisado de uma proposta, com a revisão que a aprovação precisa devolver. */
export interface PrevisaoRetro {
  title: string;
  body: string;
  revision: string;
  blocked: boolean;
}

/** Parte do estado que o módulo lê e grava. Formato estrutural: o estado da fábrica o satisfaz. */
export interface EstadoDecisoes {
  daemonPaused: boolean;
  tasks: TarefaDecisoes[];
}

/** O que o módulo precisa de um projeto: o modo de ensaio, o calendário, a Fonte, o Canal e a PO. */
export interface ProjetoDecisoes {
  dryRun: boolean;
  calendario: ProjectConfig["calendar"];
  /** Endereço base da Fonte, para montar o link do card; sem ele, não há aviso ao Teams com link. */
  baseUrl?: string;
  /** Menção da pessoa no comentário, no formato da Fonte. */
  formatMention(pessoa: string): string;
  canal: Pick<Channel, "ask" | "remind">;
  /** Configuração completa do projeto, para a publicação de retrô. */
  configuracao: ProjectConfig;
  /** Escritor de efeitos do projeto: revisa o texto público antes de qualquer publicação. */
  escritor: EffectWriter;
  /** Pessoa PO do projeto com esse id, com a identidade dela no Teams, se houver. */
  pessoaPO(id: string): { nome?: string; teamsUserId?: string } | undefined;
}

export interface EventoDecisao {
  type: "question";
  project: string;
  target: string;
  n: number;
  to: string;
  text: string;
  status: "lembrete" | "enviada";
}

/**
 * Dependências do módulo de Decisões. Quem grava o estado, publica eventos e avisa o Teams é a fábrica; o módulo só lê
 * e altera o estado pelas portas abaixo.
 */
export interface PortasDecisoes {
  estado(): Promise<EstadoDecisoes>;
  /** Altera o estado numa transação durável. */
  alterar<T>(fn: (estado: EstadoDecisoes) => T): Promise<T>;
  agora(): number;
  projeto(nome: string): ProjetoDecisoes | undefined;
  projetoPausado(estado: EstadoDecisoes, nome: string): boolean;
  /** Repositório e adaptador das retrôs da fábrica, configurados neste daemon. */
  retro(): { sink?: unknown; repo?: string };
  /** Prévia do texto público de uma proposta (revisão do escritor). */
  previsaoRetro(publicacao: PublicacaoRetro): Promise<PrevisaoRetro>;
  /** Publica uma proposta já revisada no adaptador de retrô. */
  publicarRetro(publicacao: PublicacaoRetro, previa: PrevisaoRetro): Promise<void>;
  /** `true` quando o Teams está configurado neste daemon. */
  teamsDisponivel: boolean;
  /** Aviso ao Teams de uma pergunta recém-publicada (módulo de Perguntas). */
  avisarTeams(tarefaId: string, projeto: string, chave: string, n: number): Promise<void>;
  registrarEvento(evento: EventoDecisao): Promise<void>;
}
