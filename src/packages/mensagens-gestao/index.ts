// Entry point público das regras de mensagens da gestão (Telegram): a regra de não enfileirar o mesmo aviso duas vezes.

export { podeEnviarAgora, proximoDespertar, textoDoAvisoAdiado } from "./lib/adiados.js";
export { type AvisoAdiado, avisoJaEnfileirado, type OrigemAviso } from "./lib/duplicata.js";
export { envelopeMinimoLegado } from "./lib/envelope.js";
export { aposFalhaDeEnvio, type DecisaoDeEnvio } from "./lib/envio.js";
export {
  type BotaoGestao,
  type EventoApresentado,
  ehEventoApresentado,
  type MensagemGestao,
  mensagemDoEvento,
  type PortasApresentacao,
  RASCUNHO_PERGUNTA,
  SEM_CONTEUDO,
  TOQUE_RESPONDER,
  textoDaPergunta,
  textoSpecPronta,
} from "./lib/mensagem.js";
