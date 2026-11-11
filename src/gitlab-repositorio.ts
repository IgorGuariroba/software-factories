import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { rodarGit } from "./git.js";
import { redactSecrets } from "./secrets.js";

/**
 * Repositório GitLab de um projeto criado pela interface (ADR-0018, ADR-0022): o servidor é informado pelo usuário, o
 * caminho `grupo/projeto` é conferido com o token do cofre antes de salvar, e o clone usa o mesmo token sem gravá-lo
 * no remoto.
 */

/** Servidor quando o campo fica vazio. */
export const SERVIDOR_PADRAO = "gitlab.com";
/** Tempo máximo de uma consulta à API: um GitLab travado não prende a criação para sempre. */
const TIMEOUT_MS = 30_000;

/**
 * Nome do host (com porta, se houver) a partir do que o usuário digitou. Vazio é gitlab.com; aceita a URL com
 * `https://` ou só o host. Lança erro em português se não for um servidor HTTPS sem caminho.
 */
export function hostDoServidor(servidor: string): string {
  const texto = servidor.trim();
  if (texto === "") return SERVIDOR_PADRAO;
  const erro = new Error("servidor: informe a URL do GitLab, como https://gitlab.empresa.com (vazio para gitlab.com)");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(texto) ? texto : `https://${texto}`);
  } catch {
    throw erro;
  }
  if (url.protocol !== "https:" || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) throw erro;
  return url.host.toLowerCase();
}

/**
 * Confere se o token consegue ver o repositório `caminho` no servidor `host`. Devolve a mensagem de erro, em
 * português, ou `undefined` quando o caminho está acessível.
 */
export async function verificarRepositorioGitlab(opts: {
  host: string;
  caminho: string;
  token: string;
  fetch?: typeof fetch;
}): Promise<string | undefined> {
  const url = `https://${opts.host}/api/v4/projects/${encodeURIComponent(opts.caminho)}`;
  let resposta: Response;
  try {
    resposta = await (opts.fetch ?? fetch)(url, {
      headers: { "PRIVATE-TOKEN": opts.token },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "falha de rede";
    return redactSecrets(`não foi possível consultar o GitLab em ${opts.host} (${motivo})`);
  }
  if (resposta.status === 200) return undefined;
  if (resposta.status === 401) return `o token do GitLab em ${opts.host} é inválido ou expirou`;
  if (resposta.status === 403) return `o token não tem permissão para ${opts.caminho} em ${opts.host}`;
  if (resposta.status === 404) {
    return `o repositório ${opts.caminho} não existe em ${opts.host}, ou o token não tem acesso a ele`;
  }
  return `o GitLab respondeu ${resposta.status} ao consultar ${opts.caminho} em ${opts.host}`;
}

/** Roda o git com o ambiente dado a mais, sem prompt interativo. Nenhum argumento leva segredo. */
/**
 * Clona `grupo/projeto` do servidor `host` em `destino`. O token vai só no cabeçalho da chamada do git; o remoto
 * gravado no clone é o público, sem token.
 */
export async function clonarRepositorioGitlab(opts: {
  host: string;
  caminho: string;
  token: string;
  destino: string;
}): Promise<void> {
  const url = `https://${opts.host}/${opts.caminho}.git`;
  const basic = Buffer.from(`oauth2:${opts.token}`).toString("base64");
  await rm(opts.destino, { recursive: true, force: true });
  await mkdir(dirname(opts.destino), { recursive: true });
  try {
    await rodarGit(["clone", "--quiet", "--", url, opts.destino], {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `http.https://${opts.host}/.extraheader`,
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    });
    await rodarGit(["-C", opts.destino, "remote", "set-url", "origin", url], {});
  } catch {
    await rm(opts.destino, { recursive: true, force: true });
    throw new Error(`não foi possível clonar ${opts.caminho} do GitLab em ${opts.host}`);
  }
}
