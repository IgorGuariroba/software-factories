// Entry point público do módulo de Decisões humanas: prévia com revisão e aprovação de triagem, SPEC, lembrete e pergunta
// ao PO. Cada decisão é um par GET (prévia) e POST (aprovação); a aprovação só publica com a revisão atual, nunca duas
// vezes ao mesmo tempo. Fala com a fábrica só pelas portas em `lib/portas.ts`.
import { lembrete } from "./lib/lembrete.js";
import { pergunta } from "./lib/pergunta.js";
import type { PortasDecisoes, RespostaDecisao } from "./lib/portas.js";
import { proposta, type TravasRetro } from "./lib/retro.js";
import { spec } from "./lib/spec.js";
import { triagem } from "./lib/triagem.js";

const MENSAGEM_CONFIGURACAO_OCUPADA = "Publicação ou configuração em andamento; tente novamente.";

export { motivoDeFechamento, partesDoId, referenciaDuplicata } from "./lib/comum.js";
export type {
  EstadoDecisoes,
  EventoDecisao,
  PerguntaDecisoes,
  PortasDecisoes,
  ProjetoDecisoes,
  RespostaDecisao,
  TarefaDecisoes,
} from "./lib/portas.js";

export interface Decisoes {
  /** Triagem: `decidir` falso devolve a prévia; verdadeiro registra a decisão `aceitar` ou `recusar`. */
  triagem(id: string, decidir: boolean, corpo: unknown): Promise<RespostaDecisao>;
  /** SPEC: prévia, ou aprovação local com a revisão atual. */
  spec(id: string, aprovar: boolean, corpo: unknown): Promise<RespostaDecisao>;
  /** Lembrete de uma pergunta já enviada e sem resposta. */
  lembrete(id: string, n: number, aprovar: boolean, corpo: unknown): Promise<RespostaDecisao>;
  /** Pergunta de negócio ao PO, publicada no Canal com aviso ao Teams. */
  pergunta(id: string, n: number, aprovar: boolean, corpo: unknown): Promise<RespostaDecisao>;
  /** Proposta de retrô da fábrica: prévia, ou publicação como issue com a revisão atual. */
  proposta(id: string, etapa: string, n: number, aprovar: boolean, corpo: unknown): Promise<RespostaDecisao>;
  /**
   * Configura o repositório das retrôs. Não roda junto com uma publicação de retrô: a operação recebida só executa se
   * nenhuma estiver em andamento, e enquanto ela roda nenhuma publicação começa.
   */
  configurarRepositorioRetro(operacao: () => Promise<RespostaDecisao>): Promise<RespostaDecisao>;
}

export function criarDecisoes(portas: PortasDecisoes): Decisoes {
  // Travas de publicação deste daemon: uma pergunta por vez, para não enviar duas vezes.
  const travas = new Set<string>();
  // Trava das retrôs: publicações de propostas e a configuração do repositório se excluem.
  const travasRetro: TravasRetro = { propostas: new Set<string>(), configurando: false };
  return {
    triagem: (id, decidir, corpo) => triagem(portas, id, decidir, corpo),
    spec: (id, aprovar, corpo) => spec(portas, id, aprovar, corpo),
    lembrete: (id, n, aprovar, corpo) => lembrete(portas, id, n, aprovar, corpo),
    pergunta: (id, n, aprovar, corpo) => pergunta(portas, travas, id, n, aprovar, corpo),
    proposta: (id, etapa, n, aprovar, corpo) => proposta(portas, travasRetro, id, etapa, n, aprovar, corpo),
    configurarRepositorioRetro: async (operacao) => {
      if (travasRetro.configurando || travasRetro.propostas.size > 0)
        return { status: 409, body: { error: MENSAGEM_CONFIGURACAO_OCUPADA } };
      travasRetro.configurando = true;
      try {
        return await operacao();
      } finally {
        travasRetro.configurando = false;
      }
    },
  };
}
