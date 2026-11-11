// Entry point público do módulo de Projetos: o ciclo de vida de um Projeto (criar, conectar, importar, listar pessoas)
// atrás de uma interface pequena. Quem está fora do pacote importa só este arquivo.
import type { ProjectConfig } from "../../config.js";
import { marcarPausa, pausar, remover, retomar } from "./lib/ciclo.js";
import type { CorpoCriacaoGithub, CorpoCriacaoGitlab } from "./lib/criacao.js";
import { criarGithub, criarGitlab, erroDaFonte } from "./lib/criacao.js";
import { pessoasParaCriacao } from "./lib/pessoas.js";
import type { PortasProjetos, Resposta } from "./lib/portas.js";
import { desplugarRepo, importarRepo, plugarRepo } from "./lib/repositorios.js";

export type { CorpoCriacaoGithub, CorpoCriacaoGitlab } from "./lib/criacao.js";
export type { EfeitoProjeto, EstadoProjetos, PortasProjetos, RegrasProjetos, Resposta } from "./lib/portas.js";

export interface ProjetosModulo {
  criarGithub(corpo: CorpoCriacaoGithub): Promise<Resposta>;
  criarGitlab(corpo: CorpoCriacaoGitlab): Promise<Resposta>;
  /** Pedido de importação das issues abertas de um repositório do catálogo. */
  importarRepo(repoId: number): Promise<Resposta>;
  plugarRepo(repo: string): Promise<Resposta>;
  desplugarRepo(repo: string, force: boolean): Promise<Resposta>;
  /** Pausa e retomada validadas (rotas HTTP). */
  pausar(nome: string): Promise<Resposta>;
  retomar(nome: string): Promise<Resposta>;
  /** Remoção confirmada pelo nome do projeto. */
  remover(nome: string, confirmar: unknown): Promise<Resposta>;
  /** Marca ou desmarca a pausa sem validar a configuração (comandos do Telegram e da interface de gestão). */
  marcarPausa(nome: string, pausado: boolean): Promise<void>;
  /** Erro de credencial ou de conexão de uma Fonte, sem gravar nada. */
  erroDaFonte(fonte: ProjectConfig["source"]): Promise<string | undefined>;
  /** Lista de pessoas da Fonte para escolher PO e tech lead no formulário. Só consulta; nada é gravado. */
  pessoasParaCriacao(corpo: unknown): Promise<Resposta>;
}

export function createProjetos(portas: PortasProjetos): ProjetosModulo {
  return {
    criarGithub: (corpo) => criarGithub(portas, corpo),
    criarGitlab: (corpo) => criarGitlab(portas, corpo),
    importarRepo: (repoId) => importarRepo(portas, repoId),
    plugarRepo: (repo) => plugarRepo(portas, repo),
    desplugarRepo: (repo, force) => desplugarRepo(portas, repo, force),
    pausar: (nome) => pausar(portas, nome),
    retomar: (nome) => retomar(portas, nome),
    remover: (nome, confirmar) => remover(portas, nome, confirmar),
    marcarPausa: (nome, pausado) => marcarPausa(portas, nome, pausado),
    erroDaFonte: (fonte) => erroDaFonte(portas, fonte),
    pessoasParaCriacao: (corpo) => pessoasParaCriacao(portas, corpo),
  };
}
