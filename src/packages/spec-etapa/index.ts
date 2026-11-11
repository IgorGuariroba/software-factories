// Entry point público da SPEC de uma Tarefa: espera as respostas, faz a pergunta do card raso, conduz o modelo na mesma
// conversa e grava a entrega. As regras estão no módulo; o modelo, a Fonte, o canal e o estado são portas.

export { aprovacaoVigente } from "./lib/aprovacao.js";
export {
  conduzirSpec,
  type EntradaSpec,
  type PerguntaSpec,
  type PortasSpec,
  type ResultadoSpec,
  SpecBloqueada,
} from "./lib/conduzir.js";
export { decidirEscopoAlterado, type VereditoEscopo } from "./lib/escopo.js";
