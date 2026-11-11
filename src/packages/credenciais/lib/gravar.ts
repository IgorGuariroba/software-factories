import type { PortasCredenciais, RespostaCredencial } from "./portas.js";

/**
 * Troca o valor de uma credencial do cofre. Se algum projeto usa a credencial, o valor novo passa antes pelo teste de
 * conexão do Jira (um valor inválido não degrada as Tarefas em silêncio), e a troca fica no histórico de cada projeto.
 * Se o Telegram usa a credencial, a interface reinicia para ler o valor novo.
 */
export async function gravarCredencial(
  portas: PortasCredenciais,
  nome: string,
  corpo: unknown,
): Promise<RespostaCredencial> {
  const dados = corpo as { valor?: unknown } | undefined;
  if (typeof dados?.valor !== "string" || dados.valor.length === 0)
    return { status: 400, body: { error: "informe valor, o conteúdo da credencial" } };
  const valor = dados.valor;
  const usadoPor = (await portas.projetos()).filter((p) => p.credencial === nome);
  for (const { fonte } of usadoPor) {
    if (fonte.type !== "jira" || !fonte.baseUrl || !fonte.email) continue;
    const conexao = await portas.testarConexaoJira({ baseUrl: fonte.baseUrl, email: fonte.email }, valor);
    if (!conexao.ok)
      return {
        status: 400,
        body: { error: `conexão com o Jira falhou (${conexao.motivo}); a credencial ${nome} não foi trocada` },
      };
  }
  const gravado = await portas.guardar(nome, valor);
  if (await portas.telegramUsa(nome)) await portas.reiniciarTelegram();
  if (usadoPor.length > 0)
    await portas.registrarTroca(
      usadoPor.map((p) => p.nome),
      nome,
    );
  return { status: 200, body: gravado };
}
