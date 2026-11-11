import type { DemandSource } from "./demand-source.js";
import type { EffectWriter } from "./effect-writer.js";
import { isAutomationText } from "./marca-automacao.js";

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
  /**
   * Conversa do Teams onde a pergunta saiu (canal Teams de conversa, fatia 08): a resposta é lida dela, depois da
   * mensagem `apos`. Vazio em modo ensaio: nada foi enviado.
   */
  conversa?: { conversationId: string; apos: string };
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

/**
 * Canal de cada pergunta conforme a pessoa (fatia 08). A pergunta a quem tem canal `teams` sai pela conversa Teams; os
 * demais, pelo canal padrão (comentário no card). Lembrete e resposta seguem o canal em que a pergunta saiu.
 */
export function createPersonChannel(opts: {
  padrao: Channel;
  /** Canal Teams da pessoa, ou `undefined` se ela não tem como ser alcançada pelo Teams. */
  teamsDe: (personId: string) => Channel | undefined;
  /** Se a pessoa escolheu o canal `teams` para perguntas novas. */
  escolheTeams: (personId: string) => boolean;
}): Channel {
  const { padrao, teamsDe, escolheTeams } = opts;
  return {
    async ask(question) {
      const teams = escolheTeams(question.to) ? teamsDe(question.to) : undefined;
      return (teams ?? padrao).ask(question);
    },
    async remind(ref, text) {
      const teams = ref.conversa ? teamsDe(ref.to) : undefined;
      return (teams ?? padrao).remind(ref, text);
    },
    async answer(ref) {
      const teams = ref.conversa ? teamsDe(ref.to) : undefined;
      return (teams ?? padrao).answer(ref);
    },
  };
}
