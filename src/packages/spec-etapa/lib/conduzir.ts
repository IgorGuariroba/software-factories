import type { Card, CardComment, TextAttachment } from "../../../demand-source.js";
import {
  answerFollowUp,
  isShallowCard,
  SHALLOW_CARD_QUESTION,
  type SpecDelivery,
  specInput,
} from "../../../spec-stage.js";

/** Pergunta da Tarefa como a SPEC a enxerga: o texto, a resposta (se houver) e a origem. */
export interface PerguntaSpec {
  n: number;
  text: string;
  answer: string | null;
  origin: "grill" | "card-raso" | "tecnica";
  purpose?: "repositorio";
}

/** Resultado do modelo da SPEC: uma pergunta ao PO (ou técnica), ou a entrega pronta. */
export type ResultadoSpec =
  | { kind: "question"; text: string; technical: boolean }
  | { kind: "entrega"; delivery: SpecDelivery };

/** Entrada que a fábrica leva ao modelo da SPEC. */
export interface EntradaSpec {
  requestId: string;
  input: string;
  followUp: string | undefined;
}

/** Dependências da SPEC: a Tarefa, a Fonte, o modelo e o que é gravado. */
export interface PortasSpec {
  perguntas(): Promise<PerguntaSpec[]>;
  /** Card, comentários e anexos de texto. Lança se o card não existe mais. */
  cartao(): Promise<{ card: Card; comments: CardComment[]; attachments: TextAttachment[] }>;
  /** Conhecimento do projeto, se houver. */
  conhecimento(): Promise<string | undefined>;
  /** Revisão da SPEC da Tarefa (muda quando o escopo muda e a SPEC é refeita). */
  revisaoDaSpec(): Promise<number>;
  configuracao(): { questionApproval: boolean; specApproval: boolean };
  /** Leva uma pergunta ao PO (ou técnica) e a registra com os prazos. */
  perguntar(anteriores: PerguntaSpec[], texto: string, origem: "grill" | "card-raso" | "tecnica"): Promise<void>;
  /** Roda o modelo da SPEC com a entrada pronta. */
  pedirSpec(entrada: EntradaSpec): Promise<ResultadoSpec>;
  /** Grava a SPEC entregue na Tarefa. */
  gravarEntrega(entrega: SpecDelivery): Promise<void>;
}

/** Erro de negócio: a SPEC não pode seguir agora. Quem chama o converte no bloqueio da etapa. */
export class SpecBloqueada extends Error {
  override name = "SpecBloqueada";
}

/** Mensagem de seguimento que leva ao modelo a última resposta do usuário, conforme a origem da pergunta. */
function seguimentoDaResposta(
  ultima: { text: string; answer: string } | undefined,
  origem: PerguntaSpec["origin"] | undefined,
): string | undefined {
  if (!ultima) return undefined;
  if (origem === "tecnica")
    return `Resposta do usuário à pergunta técnica "${ultima.text}":\n\n${ultima.answer}\n\nSiga com a SPEC.`;
  if (origem === "grill") return answerFollowUp(ultima);
  return undefined;
}

/**
 * Conduz a SPEC (grill → SPEC). Espera enquanto houver pergunta sem resposta. Card raso gera a pergunta própria antes de
 * qualquer SPEC. Com a resposta da última pergunta, o modelo segue na mesma conversa. Se o modelo pergunta, a pergunta
 * vai ao PO (ou técnica). Ensaio de revisão sem pergunta do modelo bloqueia a SPEC. Devolve a entrega, ou `"aguardar"`.
 */
export async function conduzirSpec(portas: PortasSpec): Promise<SpecDelivery | "aguardar"> {
  const perguntas = await portas.perguntas();
  // Uma pergunta já registrada e sem resposta (ex.: reinício logo depois de perguntar): só volta a esperar.
  if (perguntas.some((q) => q.answer === null)) return "aguardar";

  const { card, comments, attachments } = await portas.cartao();
  if (perguntas.length === 0 && isShallowCard(card, comments, attachments)) {
    await portas.perguntar([], SHALLOW_CARD_QUESTION, "card-raso");
    return "aguardar";
  }

  const respondidas = perguntas.map((q) => ({ text: q.text, answer: q.answer ?? "" }));
  const ultima = respondidas.at(-1);
  const ultimaPergunta = perguntas.at(-1);
  const resultado = await portas.pedirSpec({
    // Uma SPEC refeita por mudança de escopo tem outro identificador: o motor não reaproveita a resposta antiga.
    requestId: `spec-${perguntas.length}-r${await portas.revisaoDaSpec()}`,
    input: specInput({
      card,
      comments,
      attachments,
      knowledge: await portas.conhecimento(),
      answered: respondidas,
    }),
    followUp: seguimentoDaResposta(ultima, ultimaPergunta?.origin),
  });
  if (resultado.kind === "question") {
    await portas.perguntar(perguntas, resultado.text, resultado.technical ? "tecnica" : "grill");
    return "aguardar";
  }
  const { questionApproval, specApproval } = portas.configuracao();
  if (questionApproval && !specApproval)
    throw new SpecBloqueada("ensaio de revisão: modelo não propôs pergunta; SPEC não publicada");
  await portas.gravarEntrega(resultado.delivery);
  return resultado.delivery;
}
