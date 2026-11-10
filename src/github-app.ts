import { execFile } from "node:child_process";
import { createSign } from "node:crypto";
import { mkdir, readFile as readFileFromDisk, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { RawIssue } from "./github-demand-source.js";
import { falhaDeRede, falhaDeResposta } from "./github-falhas.js";

/**
 * Painel do GitHub App (ADR-0015): consulta as instalações do App com o JWT dele e diz quais repositórios plugados
 * estão cobertos. Só lê; nunca grava nada no GitHub e nunca guarda a chave privada fora da memória do processo.
 */

/** Repositório que uma instalação do App pode acessar, com o id numérico estável do GitHub (ADR-0015, Fase 2). */
export interface CatalogoRepo {
  /** Id numérico do repositório no GitHub: não muda com renomeação ou transferência. */
  id: number;
  /** `dono/nome`, como o GitHub mostra hoje. */
  nome: string;
  dono: string;
  privado: boolean;
  instalacaoId: number;
}

export interface GitHubAppInstallation {
  id: number;
  conta: string;
  /** `all` cobre todos os repositórios da conta; `selected` só os listados em `repositorios`. */
  selecao: "all" | "selected";
  repositorios: string[];
  /** Os mesmos repositórios com id, privacidade e dono (lidos por paginação completa). */
  catalogo: CatalogoRepo[];
}

export interface GitHubAppStatus {
  /** Quando false, falta o App ID ou a chave privada no ambiente: o painel só mostra isso. */
  configurado: boolean;
  app?: { id: number; slug: string; nome: string };
  instalacoes: GitHubAppInstallation[];
  /** Falha da consulta ao GitHub (sem o token nem a chave). */
  erro?: string;
  consultadoEm: string;
}

/** O que a página "GitHub App" de Configurações mostra. */
export interface GitHubAppPanel {
  receptor: {
    /** O receptor do webhook está ligado neste processo (porta e secret definidos no ambiente). */
    ligado: boolean;
    porta: number | null;
    /** Última entrega do webhook aplicada pela fábrica (ISO 8601), ou null se ainda não houve. */
    ultimaEntregaEm: string | null;
  };
  app: GitHubAppStatus;
  repositorios: {
    projeto: string;
    repo: string;
    status: "ativo" | "desativado";
    /** true/false se o App cobre o repositório; null se não há como saber (App não configurado ou consulta falhou). */
    coberto: boolean | null;
  }[];
}

/** JWT de aplicação (RS256), válido por 9 minutos, como exige o GitHub para chamar `/app`. */
export function createAppJwt(opts: { appId: number; privateKeyPem: string; nowMs: number }): string {
  const base64url = (value: string | Buffer) =>
    Buffer.from(value).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const iat = Math.floor(opts.nowMs / 1000) - 60; // folga para o relógio do GitHub
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat, exp: iat + 600, iss: String(opts.appId) }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(opts.privateKeyPem);
  return `${header}.${payload}.${base64url(signature)}`;
}

/**
 * Para cada repositório plugado, diz se alguma instalação cobre. `null` quando não há como saber (App não consultado).
 * A comparação ignora caixa, como o resto da fábrica.
 */
export function cobertura(
  repos: string[],
  instalacoes: GitHubAppInstallation[] | undefined,
): Map<string, boolean | null> {
  const cobertos = new Set<string>();
  for (const instalacao of instalacoes ?? []) {
    if (instalacao.selecao === "all") {
      cobertos.add(`all:${instalacao.conta.toLowerCase()}`);
    }
    for (const repo of instalacao.repositorios) cobertos.add(repo.toLowerCase());
  }
  const resultado = new Map<string, boolean | null>();
  for (const repo of repos) {
    if (instalacoes === undefined) {
      resultado.set(repo, null);
      continue;
    }
    const dono = repo.split("/")[0]?.toLowerCase() ?? "";
    resultado.set(repo, cobertos.has(repo.toLowerCase()) || cobertos.has(`all:${dono}`));
  }
  return resultado;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Teto de páginas por listagem: impede uma paginação sem fim se a API responder algo inesperado. */
export const MAX_PAGINAS = 50;
const POR_PAGINA = 100;

/**
 * Junta todas as páginas de uma listagem da API. Para quando uma página vem incompleta; passar do teto é erro, para não
 * truncar a lista em silêncio.
 */
export async function todasAsPaginas<T>(
  get: (path: string) => Promise<unknown>,
  caminho: string,
  extrair: (corpo: unknown) => T[],
): Promise<T[]> {
  const itens: T[] = [];
  const separador = caminho.includes("?") ? "&" : "?";
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const lote = extrair(await get(`${caminho}${separador}per_page=${POR_PAGINA}&page=${pagina}`));
    itens.push(...lote);
    if (lote.length < POR_PAGINA) return itens;
  }
  throw new Error(`listagem ${caminho.split("?")[0]} passou de ${MAX_PAGINAS} páginas`);
}

/** Catálogo de repositórios do App, sem repetição: um repositório aparece uma vez, mesmo se mais de uma instalação o cobre. */
export function catalogoDoApp(app: Pick<GitHubAppStatus, "instalacoes">): CatalogoRepo[] {
  const porId = new Map<number, CatalogoRepo>();
  for (const instalacao of app.instalacoes) {
    for (const repo of instalacao.catalogo) if (!porId.has(repo.id)) porId.set(repo.id, repo);
  }
  return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

export interface GitHubAppChecker {
  /** Estado atual; a consulta ao GitHub é reaproveitada por `ttlMs` para não estourar o limite da API. */
  status(): Promise<GitHubAppStatus>;
  /** Issues abertas de um repositório, por todas as páginas, com o token da instalação (leitura; PRs vêm junto). */
  issuesAbertas(repo: string, instalacaoId: number): Promise<RawIssue[]>;
  /** Logins que podem ser atribuídos a issues do repositório, por todas as páginas (token da instalação). */
  responsaveisPossiveis(repo: string, instalacaoId: number): Promise<{ login: string }[]>;
  /**
   * Clona `repo` (`dono/nome`) em `destino` com o token da instalação, que vai só no cabeçalho do git (pelo ambiente,
   * nunca na linha de comando nem em `.git/config`). Refaz o clone se `destino` já existir: o diretório é gerenciado.
   */
  clonar(repo: string, instalacaoId: number, destino: string): Promise<void>;
}

/** Tempo máximo de uma chamada à API: um GitHub travado não segura a fila de importação para sempre. */
const TIMEOUT_CHAMADA_MS = 30_000;

/** Roda o git com o ambiente dado a mais, sem prompt interativo. Nenhum argumento leva segredo. */
function rodarGit(args: string[], envExtra: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { env: { ...process.env, ...envExtra, GIT_TERMINAL_PROMPT: "0" }, timeout: 300_000 },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

/**
 * Consulta o App no GitHub. A chave é lida do arquivo a cada consulta real (não fica em memória entre elas).
 * Sem `appId` ou sem caminho da chave, o checker responde `configurado: false` sem chamar a rede.
 */
export function createGitHubAppChecker(opts: {
  appId?: number;
  privateKeyPath?: string;
  fetch?: Fetch;
  readFile?: (path: string) => Promise<string>;
  now?: () => number;
  ttlMs?: number;
}): GitHubAppChecker {
  const fetchFn: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const readKey = opts.readFile ?? ((path: string) => readFileFromDisk(path, "utf8"));
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? 5 * 60_000;
  let cached: { at: number; status: GitHubAppStatus } | undefined;

  /** Chamada autenticada à API. Só o status HTTP vai para a mensagem: nunca o token nem a resposta crua. */
  async function chamar(path: string, token: string, init: RequestInit = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchFn(`https://api.github.com${path}`, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_CHAMADA_MS),
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, ...init.headers },
      });
    } catch (err) {
      throw new Error(falhaDeRede(err));
    }
    if (!res.ok) {
      throw new Error(
        falhaDeResposta({
          status: res.status,
          caminho: path.split("?")[0] ?? path,
          agora: now(),
          cabecalhos: {
            remaining: res.headers.get("x-ratelimit-remaining"),
            reset: res.headers.get("x-ratelimit-reset"),
            retryAfter: res.headers.get("retry-after"),
          },
        }),
      );
    }
    return res.json() as Promise<unknown>;
  }

  /** Token de instalação (1 hora), trocado com um JWT novo: a chave é lida de novo do arquivo a cada troca. */
  async function tokenDaInstalacao(instalacaoId: number): Promise<string> {
    if (opts.appId === undefined || !opts.privateKeyPath) throw new Error("GitHub App não configurado");
    const jwt = createAppJwt({ appId: opts.appId, privateKeyPem: await readKey(opts.privateKeyPath), nowMs: now() });
    const { token } = (await chamar(`/app/installations/${instalacaoId}/access_tokens`, jwt, { method: "POST" })) as {
      token: string;
    };
    return token;
  }

  async function consultar(appId: number, privateKeyPem: string): Promise<GitHubAppStatus> {
    const consultadoEm = new Date(now()).toISOString();
    const jwt = createAppJwt({ appId, privateKeyPem, nowMs: now() });
    const github = (path: string, init: RequestInit = {}, token = jwt) => chamar(path, token, init);
    const app = (await github("/app")) as { id: number; slug: string; name: string };
    const lista = await todasAsPaginas(
      github,
      "/app/installations",
      (corpo) =>
        corpo as {
          id: number;
          account: { login: string };
          repository_selection: "all" | "selected";
        }[],
    );
    const instalacoes: GitHubAppInstallation[] = [];
    for (const item of lista) {
      const token = await tokenDaInstalacao(item.id);
      const repos = await todasAsPaginas(
        (caminho) => github(caminho, {}, token),
        "/installation/repositories",
        (corpo) =>
          (corpo as { repositories: { id: number; full_name: string; private: boolean; owner: { login: string } }[] })
            .repositories,
      );
      instalacoes.push({
        id: item.id,
        conta: item.account.login,
        selecao: item.repository_selection,
        repositorios: repos.map((r) => r.full_name),
        catalogo: repos.map((r) => ({
          id: r.id,
          nome: r.full_name,
          dono: r.owner.login,
          privado: r.private,
          instalacaoId: item.id,
        })),
      });
    }
    return {
      configurado: true,
      app: { id: app.id, slug: app.slug, nome: app.name },
      instalacoes,
      consultadoEm,
    };
  }

  return {
    async clonar(repo, instalacaoId, destino) {
      const token = await tokenDaInstalacao(instalacaoId);
      const url = `https://github.com/${repo}.git`;
      const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
      await rm(destino, { recursive: true, force: true });
      await mkdir(dirname(destino), { recursive: true });
      try {
        await rodarGit(["clone", "--quiet", "--", url, destino], {
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
        });
        // O remoto gravado no clone é o público: o token não fica em disco depois da clonagem.
        await rodarGit(["-C", destino, "remote", "set-url", "origin", url], {});
      } catch {
        await rm(destino, { recursive: true, force: true });
        throw new Error(`não foi possível clonar ${repo} pelo GitHub App`);
      }
    },
    async responsaveisPossiveis(repo, instalacaoId) {
      const token = await tokenDaInstalacao(instalacaoId);
      return todasAsPaginas(
        (caminho) => chamar(caminho, token),
        `/repos/${repo}/assignees`,
        (corpo) => corpo as { login: string }[],
      );
    },
    async issuesAbertas(repo, instalacaoId) {
      const token = await tokenDaInstalacao(instalacaoId);
      return todasAsPaginas(
        (caminho) => chamar(caminho, token),
        `/repos/${repo}/issues?state=open`,
        (corpo) => corpo as RawIssue[],
      );
    },
    async status() {
      if (opts.appId === undefined || !opts.privateKeyPath) {
        return { configurado: false, instalacoes: [], consultadoEm: new Date(now()).toISOString() };
      }
      if (cached && now() - cached.at < ttlMs) return cached.status;
      let status: GitHubAppStatus;
      try {
        const pem = await readKey(opts.privateKeyPath);
        status = await consultar(opts.appId, pem);
      } catch (err) {
        // A mensagem nunca inclui a chave nem o token: só o status HTTP ou o erro de leitura do arquivo.
        status = {
          configurado: true,
          instalacoes: [],
          erro: err instanceof Error ? err.message : "falha desconhecida",
          consultadoEm: new Date(now()).toISOString(),
        };
      }
      cached = { at: now(), status };
      return status;
    },
  };
}
