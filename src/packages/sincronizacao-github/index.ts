// Entry point público da sincronização com o GitHub: reconciliação dos repositórios e aplicação das entregas do webhook,
// com a memória de entregas que reconhece reenvios. A regra (linha de base, janela de sobreposição, reenvio) é do módulo;
// o estado, o webhook e o efeito são portas.

export { type EfeitoWebhook, executarEfeitosWebhook, type PortasEfeitos } from "./lib/efeitos.js";
export {
  aplicarEntrega,
  EntregaComId,
  EstadoSincronizacao,
  JANELA_DE_SOBREPOSICAO_MS,
  MEMORIA_DE_ENTREGAS,
  PortasSincronizacao,
  ProjetoSincronizavel,
  reconciliar,
} from "./lib/sincronizacao.js";
