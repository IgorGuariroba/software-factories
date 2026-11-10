import { redactSecrets } from "./secrets.js";

/**
 * Pessoas da Fonte de um projeto (ticket 06, ADR-0022): a lista de quem pode ser PO ou tech lead, consultada no próprio
 * sistema da Fonte. Escolhas feitas na criação são conferidas contra essa lista antes de gravar. Uma Fonte indisponível
 * vira erro com a causa, e o projeto não é salvo.
 */

/** Pessoa que a Fonte conhece. `id` é o identificador que o projeto guarda (username, login ou accountId). */
export interface PessoaDaFonte {
  id: string;
  nome: string;
}

/** Escolhas de PO e tech lead da criação. Vazio quer dizer "ainda não escolhida" (vira pendência). */
export interface EscolhasPessoas {
  po?: string;
  techLead?: string;
}

/** Tempo máximo de uma consulta à Fonte, para um sistema travado não prender a criação. */
const TIMEOUT_MS = 30_000;
/** Página do GitLab: a listagem segue as páginas até acabar, com um teto de segurança. */
const POR_PAGINA = 100;
const MAX_PAGINAS = 20;

const NOME_DA_FONTE = { gitlab: "GitLab Issues", github: "GitHub Issues", jira: "Jira" } as const;

/** Mensagem de falha de rede ou de resposta, em português, sem segredo. */
function falhaDaFonte(tipo: keyof typeof NOME_DA_FONTE, onde: string, motivo: string): Error {
  return new Error(
    redactSecrets(`não foi possível consultar as pessoas na Fonte ${NOME_DA_FONTE[tipo]} (${onde}): ${motivo}`),
  );
}

/** Lê uma página de JSON; qualquer falha de rede ou status fora do 2xx lança o erro em português. */
async function lerJson(
  tipo: keyof typeof NOME_DA_FONTE,
  url: string,
  onde: string,
  init: RequestInit,
  fetchFn: typeof fetch,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw falhaDaFonte(tipo, onde, err instanceof Error ? err.message : "falha de rede");
  }
  if (!res.ok) throw falhaDaFonte(tipo, onde, `HTTP ${res.status}`);
  return res.json().catch(() => {
    throw falhaDaFonte(tipo, onde, "resposta inesperada");
  });
}

/**
 * Membros do projeto GitLab (inclusive os herdados do grupo). O identificador é o username, o mesmo que o assignee usa.
 */
export async function listarPessoasGitlab(opts: {
  host: string;
  caminho: string;
  token: string;
  fetch?: typeof fetch;
}): Promise<PessoaDaFonte[]> {
  const onde = `${opts.caminho} em ${opts.host}`;
  const pessoas: PessoaDaFonte[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const url = `https://${opts.host}/api/v4/projects/${encodeURIComponent(opts.caminho)}/members/all?per_page=${POR_PAGINA}&page=${pagina}`;
    const lote = (await lerJson(
      "gitlab",
      url,
      onde,
      { headers: { "PRIVATE-TOKEN": opts.token } },
      opts.fetch ?? fetch,
    )) as { username?: unknown; name?: unknown }[];
    if (!Array.isArray(lote)) throw falhaDaFonte("gitlab", onde, "resposta inesperada");
    for (const membro of lote) {
      if (typeof membro.username === "string") {
        pessoas.push({ id: membro.username, nome: typeof membro.name === "string" ? membro.name : membro.username });
      }
    }
    if (lote.length < POR_PAGINA) break;
  }
  return pessoas;
}

/**
 * Pessoas que podem ser atribuídas a issues do repositório, pelo GitHub (o token da instalação é passado pronto). O
 * identificador é o login.
 */
export function pessoasDeAssignees(corpo: unknown): PessoaDaFonte[] {
  if (!Array.isArray(corpo)) return [];
  return corpo.flatMap((item: { login?: unknown }) =>
    typeof item?.login === "string" ? [{ id: item.login, nome: item.login }] : [],
  );
}

/**
 * Usuários do Jira que podem ser responsáveis pelo projeto (`assignable/search`), sem contas de serviço. O identificador
 * é o accountId, como o Person guarda no Jira.
 */
export async function listarPessoasJira(opts: {
  baseUrl: string;
  email: string;
  token: string;
  projeto: string;
  fetch?: typeof fetch;
}): Promise<PessoaDaFonte[]> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const onde = `projeto ${opts.projeto} em ${base}`;
  const url = `${base}/rest/api/3/user/assignable/search?project=${encodeURIComponent(opts.projeto)}&maxResults=1000`;
  const corpo = await lerJson(
    "jira",
    url,
    onde,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${opts.email}:${opts.token}`).toString("base64")}`,
      },
    },
    opts.fetch ?? fetch,
  );
  if (!Array.isArray(corpo)) throw falhaDaFonte("jira", onde, "resposta inesperada");
  return (corpo as { accountId?: unknown; displayName?: unknown; accountType?: unknown; active?: unknown }[])
    .filter((u) => typeof u.accountId === "string" && u.accountType !== "app" && u.active !== false)
    .map((u) => ({
      id: u.accountId as string,
      nome: typeof u.displayName === "string" ? u.displayName : (u.accountId as string),
    }));
}

/**
 * Confere as escolhas de PO e tech lead com a lista da Fonte. Devolve o erro em português, ou `undefined` quando todas
 * existem (ou quando nada foi escolhido). Não consulta nada: quem chama já trouxe a lista.
 */
export function conferirEscolhasPessoas(
  escolhas: EscolhasPessoas | undefined,
  lista: PessoaDaFonte[],
  fonte: keyof typeof NOME_DA_FONTE,
): string | undefined {
  const rotulos: [keyof EscolhasPessoas, string][] = [
    ["po", "PO"],
    ["techLead", "tech lead"],
  ];
  for (const [chave, rotulo] of rotulos) {
    const id = escolhas?.[chave];
    if (id === undefined) continue;
    if (!lista.some((p) => p.id === id)) {
      return `${rotulo}: ${id} não existe na Fonte ${NOME_DA_FONTE[fonte]}; escolha uma pessoa da lista`;
    }
  }
  return undefined;
}
