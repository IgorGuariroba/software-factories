// Entry point público das etapas de modelo: a ferramenta de entrega (só encerra a rodada) e a leitura da entrega na
// transcrição. As etapas (SPEC, triagem, revisão, retrô) decidem o que fazer com a chamada; o laço é daqui.

export { type ConfiguracaoDaConversa, criarConversaDaTarefa } from "./lib/conversa.js";
export {
  type ChamadaFerramenta,
  type ConversaLida,
  chamadaDaUltimaRodada,
  chamadaDoPedido,
  EXECUCAO_DE_ENTREGA,
} from "./lib/entrega.js";
