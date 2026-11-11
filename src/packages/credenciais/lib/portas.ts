/** Fonte de um projeto, no que a troca de credencial lê: o tipo e, no Jira, o endereço e o e-mail da conexão. */
export interface FonteDoProjeto {
  type: string;
  baseUrl?: string;
  email?: string;
}

/** Resultado do teste de conexão com o Jira usando a credencial nova. */
export type ResultadoConexao = { ok: true } | { ok: false; motivo: string };

/** Resposta de um endpoint de credenciais: status HTTP e corpo. */
export interface RespostaCredencial {
  status: number;
  body: unknown;
}

/**
 * Dependências do cofre de credenciais. A regra de troca (quem usa a credencial, o teste de conexão antes de trocar, o
 * histórico e o reinício do Telegram) é do módulo; gravar no cofre, ler a configuração e reiniciar a interface são
 * portas.
 */
export interface PortasCredenciais {
  /** Todos os projetos, com a credencial que a Fonte de cada um usa (se usa alguma) e a Fonte. */
  projetos(): Promise<{ nome: string; credencial?: string; fonte: FonteDoProjeto }[]>;
  /** Testa a conexão com o Jira usando o valor novo, antes de trocar a credencial. */
  testarConexaoJira(conexao: { baseUrl: string; email: string }, valor: string): Promise<ResultadoConexao>;
  /** Grava o valor no cofre. */
  guardar(nome: string, valor: string): Promise<unknown>;
  /** A interface do Telegram usa esta credencial? Se sim, ela reinicia ao trocar. */
  telegramUsa(nome: string): Promise<boolean>;
  reiniciarTelegram(): Promise<void>;
  /** Registra no histórico de configuração de cada projeto que a credencial foi trocada. */
  registrarTroca(projetos: string[], nome: string): Promise<void>;
}
