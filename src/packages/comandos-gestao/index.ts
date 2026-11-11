// Entry point público da interpretação dos comandos da gestão (Telegram): o que a mensagem quer dizer, a resposta de uma
// pergunta, e qual Tarefa a referência aponta. Sem I/O: quem executa o comando é a fábrica.
export {
  type Comando,
  type ComandoTarefa,
  interpretarComando,
  resolverTarefa,
  respostaDaPergunta,
} from "./lib/comando.js";
export {
  cursorDepois,
  deveZerarCursor,
  esperaAteZerarCursor,
  JANELA_DE_SILENCIO_MS,
  jaTratada,
} from "./lib/recebimento.js";
