import type { ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";
import type { ConversationId } from "@earendil-works/pi-durable";
import type { ModelRef } from "../../../config.js";
import type { Card, CardComment } from "../../../demand-source.js";
import { deterministicTriage, type TriageResult, type TriageSignals, trustedContext } from "../../../triage.js";
import { classifyTriage } from "../../../triage-classificador.js";

/** Sinais da issue colhidos da Fonte e do repositório. */
export interface ColetaIssue {
  sinais: TriageSignals;
  /** Caminho do repositório local da issue, se ela tem um mapeamento; sem ele, não há histórico recente. */
  caminhoRepo: string | undefined;
}

/** Entrada do modelo: só o contexto que passou pelo filtro de confiança. */
export interface ContextoTriagem {
  card: Card;
  comments: CardComment[];
  others: Card[];
  recentCommits: string[];
  knowledge: string | undefined;
}

/** Dependências da avaliação. A regra de escolha fica no módulo; o I/O e o modelo ficam nas portas. */
export interface PortasAvaliacao {
  /** Colhe os sinais da issue. Lança se a issue não existe mais. */
  coletar(): Promise<ColetaIssue>;
  /** Assuntos dos commits recentes do repositório. */
  assuntosRecentes(caminhoRepo: string): Promise<string[]>;
  /** Conhecimento do projeto, se houver. */
  conhecimento(): Promise<string | undefined>;
  /** Papel de triagem do projeto (o de triagem, ou o de SPEC quando não há um). */
  papelDeTriagem(): ModelRef;
  /** Classificador do mesmo provedor e modelo do papel, se houver. */
  classificador(papel: ModelRef): ((contexto: ClassifierContext) => Promise<ClassifierResult>) | undefined;
  /** Triagem pelo modelo, na conversa da triagem desta Tarefa. */
  modeloDeTriagem(conversa: ConversationId | null, papel: ModelRef, contexto: ContextoTriagem): Promise<TriageResult>;
}

/**
 * Decide a triagem de uma issue. Primeiro as regras determinísticas; sem decisão, um classificador do papel (se houver) ou
 * o modelo. Só o contexto confiável (sem frases de injeção) chega ao modelo.
 */
export async function avaliarIssue(portas: PortasAvaliacao, conversa: ConversationId | null): Promise<TriageResult> {
  const { sinais, caminhoRepo } = await portas.coletar();
  const decidido = deterministicTriage(sinais);
  if (decidido) return decidido;
  const contexto = trustedContext(sinais.others, caminhoRepo ? await portas.assuntosRecentes(caminhoRepo) : []);
  const papel = portas.papelDeTriagem();
  const base: ContextoTriagem = {
    card: sinais.card,
    comments: sinais.comments,
    others: contexto.others,
    recentCommits: contexto.recentCommits,
    knowledge: await portas.conhecimento(),
  };
  const classificar = portas.classificador(papel);
  if (classificar) return classifyTriage({ ...base, classify: classificar });
  return portas.modeloDeTriagem(conversa, papel, base);
}
