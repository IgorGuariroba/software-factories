/**
 * Checa a conexão com o Jira antes de salvar uma Fonte que usa credencial (fatia 03). Chama o endpoint de identidade
 * com autenticação básica (e-mail e token). O token nunca aparece na mensagem de erro.
 */
export async function testarConexaoJira(opts: {
  baseUrl: string;
  email: string;
  token: string;
  fetch: typeof fetch;
}): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const basic = Buffer.from(`${opts.email}:${opts.token}`).toString("base64");
  try {
    const res = await opts.fetch(`${opts.baseUrl}/rest/api/3/myself`, {
      headers: { authorization: `Basic ${basic}`, accept: "application/json" },
    });
    if (res.ok) return { ok: true };
    return { ok: false, motivo: `HTTP ${res.status}` };
  } catch {
    return { ok: false, motivo: "sem resposta do servidor" };
  }
}
