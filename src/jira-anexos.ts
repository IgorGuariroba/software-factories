// Leitura de anexos do Jira: o acli não baixa anexos, então a leitura é por HTTP com credencial do Atlassian.

export interface AttachmentInfo {
  id: string;
  filename: string;
  mimeType?: string;
  contentUrl?: string;
  size?: number;
}

export type AttachmentReader = (attachment: AttachmentInfo) => Promise<string>;

export const MISSING_ATTACHMENT_CREDENTIALS = "[conteúdo não lido: defina ATLASSIAN_EMAIL e ATLASSIAN_API_TOKEN]";

/**
 * Leitor de anexos por HTTP com autenticação básica (`ATLASSIAN_EMAIL` + `ATLASSIAN_API_TOKEN`), já que o `acli` não
 * baixa anexos. Sem credencial, devolve um conteúdo que diz isso explicitamente. Com credencial, qualquer falha lança
 * erro (a Tarefa é tentada de novo). O token nunca aparece na mensagem de erro.
 */
export function createHttpAttachmentReader(
  opts: {
    env?: Record<string, string | undefined>;
    credentials?: () => Promise<{ email: string; token: string } | undefined>;
    fetch?: typeof fetch;
    timeoutMs?: number;
    baseUrl?: string;
  } = {},
): AttachmentReader {
  return async (attachment) => {
    const env = opts.env ?? process.env;
    const doCofre = opts.credentials ? await opts.credentials() : undefined;
    const email = doCofre ? doCofre.email : env.ATLASSIAN_EMAIL;
    const token = doCofre ? doCofre.token : env.ATLASSIAN_API_TOKEN;
    if (!email || !token) return MISSING_ATTACHMENT_CREDENTIALS;
    const what = `anexo ${attachment.filename} (id ${attachment.id})`;
    const url =
      opts.baseUrl && attachment.id
        ? `${opts.baseUrl.replace(/\/+$/, "")}/rest/api/3/attachment/content/${encodeURIComponent(attachment.id)}`
        : attachment.contentUrl;
    if (!url) throw new Error(`Falha ao ler ${what}: o Jira não informou a URL do conteúdo`);
    const doFetch = opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
    } catch (error) {
      throw new Error(`Falha de rede ao baixar ${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!res.ok) throw new Error(`Falha ao baixar ${what}: HTTP ${res.status}`);
    return await res.text();
  };
}
