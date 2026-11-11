/** Resultado de uma importação: o que fez com as issues abertas do repositório. */
export interface ResultadoImportacao {
  criadas: number;
  vinculadas: number;
  atualizadas: number;
  ignoradas: number;
}

/** Registro de importação de um repositório, como o módulo o grava. */
export interface RegistroImportacao {
  repoId: number;
  repo: string;
  status: "nunca" | "importando" | "ok" | "erro";
  ultimaImportacaoEm?: string;
  ultimoErro?: string;
  installationId?: number;
  ultimoResultado?: ResultadoImportacao;
}

/** Parte do estado que o módulo lê e grava. Formato estrutural: o estado da fábrica o satisfaz. */
export interface EstadoImportacao {
  importacoes?: Record<string, RegistroImportacao>;
}

/** Repositório do catálogo do GitHub App, no ponto de vista da importação. */
export interface RepoDoApp {
  id: number;
  nome: string;
  instalacaoId: number;
}

/** Entradas da aplicação das issues: o projeto que monitora o repositório e as issues abertas lidas do GitHub. */
export interface AlvoImportacao<Issue> {
  projeto: string;
  repoId: number;
  repo: string;
  instalacaoId: number;
  issues: Issue[];
}

/**
 * Dependências do módulo de Importação. `Issue` e `Efeito` são opacos aqui: a fábrica define o que é uma issue lida do
 * GitHub e um efeito de webhook, e o módulo só os repassa. Assim o pacote não depende da camada de Fonte nem do estado
 * durável.
 */
export interface PortasImportacao<Issue, Efeito> {
  estado(): Promise<EstadoImportacao>;
  /** Altera o estado numa transação durável. Se a função lançar, nada é gravado. */
  alterar<T>(fn: (estado: EstadoImportacao) => T): Promise<T>;
  agora(): number;
  /** Situação do GitHub App: configurado e, se houver, o erro da última consulta. */
  statusDoApp(): Promise<{ configurado: boolean; erro?: string }>;
  /** Repositório com esse id no catálogo do App, se ele ainda existir lá. */
  repoDoApp(repoId: number): Promise<RepoDoApp | undefined>;
  /** Projeto monitorado que aponta para `dono/nome`, se houver. */
  projetoDoRepo(nome: string): string | undefined;
  issuesAbertas(nome: string, instalacaoId: number): Promise<Issue[]>;
  /**
   * Aplica as issues ao estado da transação e devolve o resultado e os efeitos. Lança se o projeto não estiver
   * carregado: a transação inteira é desfeita.
   */
  aplicar(estado: EstadoImportacao, alvo: AlvoImportacao<Issue>): { resultado: ResultadoImportacao; efeitos: Efeito[] };
  /** Executa os efeitos depois da gravação (avisos, Tarefas criadas ou atualizadas). */
  executarEfeitos(efeitos: Efeito[]): Promise<void>;
  /** Remove segredos de um texto antes de guardá-lo no estado ou no log. */
  redigir(texto: string): string;
}
