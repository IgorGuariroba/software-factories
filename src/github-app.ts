import { createSign } from "node:crypto";
import { readFile as readFileFromDisk } from "node:fs/promises";

/**
 * Painel do GitHub App (ADR-0015): consulta as instalações do App com o JWT dele e diz quais repositórios plugados
 * estão cobertos. Só lê; nunca grava nada no GitHub e nunca guarda a chave privada fora da memória do processo.
 */

export interface GitHubAppInstallation {
  id: number;
  conta: string;
  /** `all` cobre todos os repositórios da conta; `selected` só os listados em `repositorios`. */
  selecao: "all" | "selected";
  repositorios: string[];
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

export interface GitHubAppChecker {
  /** Estado atual; a consulta ao GitHub é reaproveitada por `ttlMs` para não estourar o limite da API. */
  status(): Promise<GitHubAppStatus>;
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

  async function consultar(appId: number, privateKeyPem: string): Promise<GitHubAppStatus> {
    const consultadoEm = new Date(now()).toISOString();
    const jwt = createAppJwt({ appId, privateKeyPem, nowMs: now() });
    const github = async (path: string, init: RequestInit = {}, token = jwt) => {
      const res = await fetchFn(`https://api.github.com${path}`, {
        ...init,
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, ...init.headers },
      });
      if (!res.ok) throw new Error(`GitHub respondeu ${res.status} em ${path.split("?")[0]}`);
      return res.json() as Promise<unknown>;
    };
    const app = (await github("/app")) as { id: number; slug: string; name: string };
    const lista = (await github("/app/installations?per_page=100")) as {
      id: number;
      account: { login: string };
      repository_selection: "all" | "selected";
    }[];
    const instalacoes: GitHubAppInstallation[] = [];
    for (const item of lista) {
      const { token } = (await github(`/app/installations/${item.id}/access_tokens`, { method: "POST" })) as {
        token: string;
      };
      const repos = (await github("/installation/repositories?per_page=100", {}, token)) as {
        repositories: { full_name: string }[];
      };
      instalacoes.push({
        id: item.id,
        conta: item.account.login,
        selecao: item.repository_selection,
        repositorios: repos.repositories.map((r) => r.full_name),
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
