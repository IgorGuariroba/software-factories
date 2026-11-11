/** Configuração do Telegram guardada, no que a escolha da interface usa. */
export interface ConfiguracaoSalva {
  chat: string;
  usuario: string;
  credential?: string;
}

/** Resultado da escolha: a interface que a configuração salva determina, com o token já lido do cofre. */
export interface InterfaceSalva {
  token: string;
  chat: string;
  usuario: string;
}

/**
 * A interface de gestão salva pela API só vale com credencial, com a fábrica sabendo criar a interface, e com o token
 * existente no cofre. Sem qualquer um desses, não há interface salva (o token sai do cofre, nunca do arquivo).
 */
export async function interfaceSalvaVigente(portas: {
  guardada(): Promise<ConfiguracaoSalva | undefined>;
  podeCriarInterface: boolean;
  tokenDe(credencial: string): Promise<string | undefined>;
}): Promise<InterfaceSalva | undefined> {
  const salva = await portas.guardada();
  if (!salva?.credential || !portas.podeCriarInterface) return undefined;
  const token = await portas.tokenDe(salva.credential);
  if (!token) return undefined;
  return { token, chat: salva.chat, usuario: salva.usuario };
}

/**
 * Reiniciar a interface depois de salvar a configuração: só quando é a configuração salva que manda. A variável de
 * ambiente tem prioridade e não muda com a API.
 */
export function reiniciaAposSalvar(ambienteDefinido: boolean): boolean {
  return !ambienteDefinido;
}
