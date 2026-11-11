import type { ProjectConfig } from "../../../config.js";
import type { GitHubAppChecker } from "../../../github-app.js";
import type { ReservaDeProjeto } from "../../../projetos-github.js";

/** Resposta de uma operação do módulo: o código HTTP e o corpo, decididos aqui e não pela rota. */
export interface Resposta {
  status: number;
  body: unknown;
}

/**
 * Parte do estado durável que o módulo lê e grava. É estrutural de propósito: o pacote não importa o estado da fábrica
 * (e os módulos que o tipam), para não criar ciclo de dependências. O estado real satisfaz este formato.
 */
export interface EstadoProjetos {
  tasks: {
    id: string;
    project: string;
    status: string;
    pauseRequested?: boolean;
    durableId?: unknown;
    reason?: string | null;
  }[];
  repos?: Record<string, { repo: string; status: string; motivo?: string; installationId?: number; repoId?: number }>;
  importacoes?: Record<
    string,
    {
      repoId?: number;
      repo?: string;
      status: string;
      installationId?: number;
      ultimaImportacaoEm?: string;
      ultimoResultado?: unknown;
    }
  >;
  projetos?: Record<string, string>;
  projetosGitHub?: Record<string, string>;
  projetosPausados?: string[];
  projetosAguardandoConfirmacao?: string[];
  projetosRemovidos?: Record<string, { prefixo: string; quando: string }>;
  sincronizadoEm?: Record<string, string>;
  historicoConfig?: Record<string, { quando: string; autor: string; campos: string[] }[]>;
}

/** Efeito que a fábrica aplica depois de uma gravação (ex.: abortar a execução de uma Tarefa). */
export interface EfeitoProjeto {
  readonly type: string;
}

/**
 * Regras de domínio que moram fora deste pacote (repositórios, pausa, remoção, confirmação de Fonte). A fábrica as
 * injeta; o pacote só as chama.
 */
export interface RegrasProjetos {
  projetosReservados(state: EstadoProjetos): ReservaDeProjeto[];
  repoDesativado(state: EstadoProjetos, projeto: string): boolean;
  projetoPausado(state: EstadoProjetos, projeto: string): boolean;
  tarefasAtivas(state: EstadoProjetos, projeto: string): { id: string }[];
  tarefasEmAndamento(state: EstadoProjetos, projeto: string): { id: string }[];
  ativarProjeto(opts: { state: EstadoProjetos; project: string; repo: string }): void;
  desativarProjeto(opts: { state: EstadoProjetos; project: string; repo: string; motivo: string; force: boolean }): {
    effects: readonly EfeitoProjeto[];
  };
  aguardandoConfirmacao(state: EstadoProjetos, projeto: string): boolean;
  comConfirmacaoPendente(pendencias: string[], state: EstadoProjetos, projeto: string): string[];
}

/**
 * Portas do módulo de Projetos. O módulo não conhece o daemon: recebe o estado durável, o cofre, o checador do GitHub App,
 * as regras e o registro de projetos da fábrica. A implementação real é montada em `startFactory`.
 */
export interface PortasProjetos {
  /** Verdadeiro quando este daemon cria a Fonte de projetos pela interface. */
  criacaoHabilitada: boolean;
  /** Projeto do YAML que serve de padrão para os campos que a criação não informa. */
  padrao: ProjectConfig | undefined;
  /** Diretório gerenciado onde a fábrica clona o repositório de um projeto criado pela interface. */
  caminhoDoClone(nome: string): string;
  segredos: {
    has(nome: string): Promise<boolean>;
    get(nome: string): Promise<string | undefined>;
  };
  github: GitHubAppChecker;
  estado: {
    ler(): Promise<EstadoProjetos>;
    /** Altera o estado numa transação durável. */
    alterar<T>(fn: (state: EstadoProjetos) => T | Promise<T>): Promise<T>;
  };
  /** Registra no processo um projeto recém-criado, com a Fonte e o conhecimento dele. */
  registrar(config: ProjectConfig): void;
  /** Projetos ativos no processo agora (os do YAML e os criados pela interface já carregados). */
  projetosAtivos(): ProjectConfig[];
  agora(): number;
  /** Nome do projeto que monitora o repositório `dono/nome`, ou `undefined` se nenhum monitora. */
  projetoDoRepositorio(repo: string): string | undefined;
  /** Pendências que barram ações do projeto (incompleto, troca de Fonte aguardando confirmação). */
  pendenciasBloqueantes(nome: string, state: EstadoProjetos): string[];
  /** Fila de importação: a execução de fato (leitura das issues) fica na fábrica. */
  importacao: { enfileirar(repoId: number): void };
  /** Efeitos do webhook (abortar execução, etc.) aplicados depois da gravação. */
  efeitos: { executar(efeitos: readonly EfeitoProjeto[]): Promise<void> };
  regras: RegrasProjetos;
  /** Estado que só a fábrica guarda na memória do processo (projetos carregados e instâncias de fonte). */
  fabrica: { esquecer(nome: string): void };
  /** Substituições de rede e de clone, usadas em teste. Sem elas, o módulo usa as implementações reais. */
  fetchFonte?: typeof fetch;
  fetchGitlab?: typeof fetch;
  clonarGithub?: (opts: { repo: string; instalacaoId: number; destino: string }) => Promise<void>;
  clonarGitlab?: (opts: { host: string; caminho: string; token: string; destino: string }) => Promise<void>;
}
