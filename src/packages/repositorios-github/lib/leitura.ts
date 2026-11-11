import {
  type CatalogoRepo,
  catalogoDoApp,
  cobertura,
  type GitHubAppPanel,
  type GitHubAppStatus,
} from "../../../github-app.js";

/** Projeto que monitora um repositório do GitHub. */
export interface ProjetoGitHub {
  nome: string;
  repo: string;
}

/** Vínculo de um projeto ao repositório: ativo ou desativado, e de qual instalação do App veio. */
export interface VinculoRepo {
  status: "ativo" | "desativado";
  installationId?: number | null;
  motivo?: string | null;
}

/** Registro de importação de um repositório, como a leitura o mostra. */
export interface ImportacaoRepo {
  repoId: number;
  repo: string;
  status: "nunca" | "importando" | "ok" | "erro";
  ultimaImportacaoEm?: string;
  ultimoErro?: string;
  installationId?: number;
  ultimoResultado?: { criadas: number; vinculadas: number; atualizadas: number; ignoradas: number };
}

/** Parte do estado que a leitura lê. Formato estrutural: o estado da fábrica o satisfaz. */
export interface EstadoRepositorios {
  repos?: Record<string, VinculoRepo | undefined>;
  importacoes?: Record<string, ImportacaoRepo | undefined>;
  ultimoWebhookEm?: string;
}

/** Dependências da leitura de repositórios do GitHub. */
export interface PortasRepositoriosGitHub {
  estado(): Promise<EstadoRepositorios>;
  /** Projetos de repositório monitorado, com o repositório de cada um. */
  projetosGitHub(): ProjetoGitHub[];
  /** Situação do GitHub App, consultada (ou reaproveitada do cache). */
  statusDoApp(): Promise<GitHubAppStatus>;
  /** O receptor do webhook está ligado neste processo? Com a porta, se estiver. */
  receptor(): { ligado: boolean; porta: number | null };
}

/** Vínculo de um projeto a um repositório, para a listagem. */
export interface ItemRepo {
  project: string;
  repo: string;
  status: "ativo" | "desativado";
  installationId: number | null;
  motivo: string | null;
}

/** Catálogo do App com o plugue e a importação de cada repositório. */
export interface CatalogoGitHub {
  configurado: boolean;
  erro?: string;
  consultadoEm: string;
  repos: (CatalogoRepo & {
    plugado: { projeto: string; status: "ativo" | "desativado" } | null;
    importacao: ImportacaoRepo | null;
  })[];
}

/**
 * O App foi consultado com sucesso: só então o catálogo e a cobertura são confiáveis. Sem isso, a leitura não afirma
 * repositórios nem cobertura.
 */
function consultaDoAppOk(app: GitHubAppStatus): boolean {
  return app.configurado && !app.erro;
}

/** Projetos monitorados e o estado dos vínculos deles. Sem vínculo gravado, o repositório está ativo. */
export async function listarRepos(portas: PortasRepositoriosGitHub): Promise<ItemRepo[]> {
  const estado = await portas.estado();
  return portas.projetosGitHub().map((projeto) => {
    const vinculo = estado.repos?.[projeto.nome];
    return {
      project: projeto.nome,
      repo: projeto.repo,
      status: vinculo?.status ?? "ativo",
      installationId: vinculo?.installationId ?? null,
      motivo: vinculo?.motivo ?? null,
    };
  });
}

/**
 * Catálogo de repositórios do App: só leitura, sem token nem chave. `plugado` diz se algum projeto já aponta para o
 * repositório (comparação sem caixa), com o status do vínculo.
 */
export async function catalogo(portas: PortasRepositoriosGitHub): Promise<CatalogoGitHub> {
  const app = await portas.statusDoApp();
  const plugados = new Map((await listarRepos(portas)).map((r) => [r.repo.toLowerCase(), r]));
  const importacoes = (await portas.estado()).importacoes ?? {};
  const repos = consultaDoAppOk(app) ? catalogoDoApp(app) : [];
  return {
    configurado: app.configurado,
    ...(app.erro ? { erro: app.erro } : {}),
    consultadoEm: app.consultadoEm,
    repos: repos.map((r) => {
      const plugado = plugados.get(r.nome.toLowerCase());
      return {
        ...r,
        plugado: plugado ? { projeto: plugado.project, status: plugado.status } : null,
        importacao: importacoes[String(r.id)] ?? null,
      };
    }),
  };
}

/**
 * Painel do GitHub App. A cobertura só é dita quando a consulta ao App deu certo: sem ela, `coberto` é `null`, e a página
 * não afirma nada que não sabe.
 */
export async function painel(portas: PortasRepositoriosGitHub): Promise<GitHubAppPanel> {
  const estado = await portas.estado();
  const app = await portas.statusDoApp();
  const repos = await listarRepos(portas);
  const ativos = repos.filter((r) => r.status === "ativo").map((r) => r.repo);
  const cobertos = cobertura(ativos, consultaDoAppOk(app) ? app.instalacoes : undefined);
  const receptor = portas.receptor();
  return {
    receptor: {
      ligado: receptor.ligado,
      porta: receptor.porta,
      ultimaEntregaEm: estado.ultimoWebhookEm ?? null,
    },
    app,
    repositorios: repos.map((r) => ({
      projeto: r.project,
      repo: r.repo,
      status: r.status,
      coberto: r.status === "ativo" ? (cobertos.get(r.repo) ?? null) : null,
    })),
  };
}

/**
 * Projeto que monitora este repositório (`dono/nome`, sem diferenciar caixa), se houver. A fábrica usa para achar o projeto
 * de uma issue que chega pelo webhook ou pela importação.
 */
export function projetoDoRepositorio(projetos: ProjetoGitHub[], repo: string): ProjetoGitHub | undefined {
  return projetos.find((p) => p.repo.toLowerCase() === repo.toLowerCase());
}
