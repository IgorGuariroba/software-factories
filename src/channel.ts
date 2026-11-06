import type { DemandSource } from "./demand-source.js";
import { type EffectWriter, isAutomationText } from "./effect-writer.js";

/**
 * Onde uma pergunta foi feita, para lembrar e achar a resposta depois (inclusive após um reinício). A fábrica guarda
 * e devolve como recebeu; só o adaptador do Canal entende o conteúdo.
 */
export type QuestionRef = {
  card: string;
  /** Pessoa do projeto a quem a pergunta foi feita. */
  to: string;
  /** Comentários que já existiam no card quando a pergunta saiu: nenhum deles é resposta. */
  before: string[];
};

/** Porta para a conversa com as pessoas do projeto (Teams, Slack, comentário no card). */
export interface Channel {
  /** Envia a pergunta `text` à pessoa `to` sobre o card. Repetir a mesma pergunta não a duplica. */
  ask(question: { card: string; to: string; text: string }): Promise<QuestionRef>;
  /** Lembra a pessoa de uma pergunta ainda sem resposta. Repetir o mesmo lembrete não o duplica. */
  remind(ref: QuestionRef, text: string): Promise<void>;
  /** A resposta da pessoa, se já houver; `undefined` enquanto ela não responder. */
  answer(ref: QuestionRef): Promise<string | undefined>;
}

/**
 * O Canal do M1: a pergunta é um comentário no card (sem token de menção, que o Jira mostraria como texto; o aviso vai pelo Teams), e a resposta é qualquer comentário dela no
 * card depois da pergunta. Toda escrita passa pelo escritor de efeitos (guardrails, prefixo, filtro de segredos e
 * dry-run); a leitura das respostas é real também no dry-run.
 */
export function createCardCommentChannel(opts: { source: DemandSource; writer: EffectWriter }): Channel {
  const { source, writer } = opts;
  return {
    async ask({ card, to, text }) {
      const before = (await source.listComments(card)).map((c) => c.id);
      await writer.mention(card, to, text);
      return { card, to, before };
    },

    async remind(ref, text) {
      await writer.mention(ref.card, ref.to, text);
    },

    async answer(ref) {
      const replies = (await source.listComments(ref.card)).filter(
        (c) => c.author === ref.to && !ref.before.includes(c.id) && !isAutomationText(c.body),
      );
      return replies.length > 0 ? replies.map((c) => c.body).join("\n\n") : undefined;
    },
  };
}
