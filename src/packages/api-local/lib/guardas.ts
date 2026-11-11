/** O que as guardas leem do pedido: o método, o Host e a Origin. */
export interface PedidoLocal {
  metodo: string;
  host?: string;
  origem?: string;
}

/**
 * Só clientes locais: o Host precisa ser localhost ou 127.0.0.1 na porta do servidor (barra DNS rebinding), e um POST
 * com Origin precisa vir dessas mesmas origens (barra CSRF de páginas abertas no navegador).
 */
export function ehClienteLocal(pedido: PedidoLocal, hosts: ReadonlySet<string>): boolean {
  if (!hosts.has((pedido.host ?? "").toLowerCase())) return false;
  if (pedido.metodo !== "POST" || pedido.origem === undefined) return true;
  const origem = pedido.origem.toLowerCase();
  return [...hosts].some((h) => origem === `http://${h}`);
}

/** Content-Type JSON, ignorando parâmetros (`; charset=utf-8`) e a caixa. */
export function ehJson(contentType: string | undefined): boolean {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() === "application/json";
}
