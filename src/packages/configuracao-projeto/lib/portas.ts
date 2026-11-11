import type { ProjectConfig } from "../../../config.js";

/** Histórico de uma alteração de configuração. */
export interface RegistroHistorico {
  quando: string;
  autor: string;
  campos: string[];
}

/** Parte do estado que a configuração de projetos lê e grava. Formato estrutural: o estado da fábrica o satisfaz. */
export interface EstadoConfiguracao {
  projetos?: Record<string, string>;
  projetosAguardandoConfirmacao?: string[];
  projetosPausados?: string[];
  historicoConfig?: Record<string, RegistroHistorico[]>;
  projetosRemovidos?: Record<string, unknown>;
}

/** Resposta de um endpoint de configuração: status HTTP e corpo. */
export interface RespostaConfiguracao {
  status: number;
  body: unknown;
}

/** Dependências da configuração de projetos. */
export interface PortasConfiguracaoProjeto {
  estado(): Promise<EstadoConfiguracao>;
  /** Altera o estado numa transação durável. */
  alterar<T>(fn: (estado: EstadoConfiguracao) => T): Promise<T>;
  agora(): number;
  /** Ids das Tarefas do projeto que ainda estão em andamento. */
  tarefasEmAndamento(estado: EstadoConfiguracao, nome: string): string[];
  /** Caminho existe e é diretório. */
  ehDiretorio(caminho: string): Promise<boolean>;
  /** Mensagem de erro da Fonte (credencial, conexão), se houver. */
  erroDaFonte(fonte: ProjectConfig["source"]): Promise<string | undefined>;
  /** Aplica a configuração salva aos projetos carregados. */
  aplicar(config: ProjectConfig): void;
}
