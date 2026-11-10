import type { Channel, QuestionRef } from "./channel.js";
import { withAutomationMark } from "./effect-writer.js";
import { redactSecrets } from "./secrets.js";
import type { TeamsConversation } from "./teams-conversa.js";

/**
 * Canal Teams de conversa (fatia 08): a pergunta vai pela conversa 1:1 da pessoa e a resposta é lida dela. Toda
 * mensagem sai sem segredos e com a marca de automação. Em ensaio, nada é enviado; a resposta fica sem ler.
 */
export function createTeamsChannel(opts: {
  conversation: TeamsConversation;
  /** MRI da pessoa no Teams (`8:orgid:...`). */
  personMri: string;
  dryRun?: boolean;
}): Channel {
  const { conversation, personMri } = opts;

  async function envia(text: string): Promise<{ conversationId: string; messageId: string } | undefined> {
    if (opts.dryRun) return undefined;
    return conversation.send(personMri, withAutomationMark(redactSecrets(text)));
  }

  return {
    async ask({ card, to, text }) {
      const enviada = await envia(text);
      const ref: QuestionRef = {
        card,
        to,
        before: [],
        conversa: enviada
          ? { conversationId: enviada.conversationId, apos: enviada.messageId }
          : { conversationId: "", apos: "" },
      };
      return ref;
    },

    async remind(_ref, text) {
      await envia(text);
    },

    async answer(ref) {
      const conversa = ref.conversa;
      if (!conversa?.apos) return undefined;
      const respostas = await conversation.repliesFrom(conversa.conversationId, conversa.apos, personMri);
      return respostas.length > 0 ? respostas.map((r) => r.body).join("\n\n") : undefined;
    },
  };
}
