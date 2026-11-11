/** Configuração do Telegram guardada: a conversa do bot, o usuário autorizado e, opcionalmente, a credencial do token. */
export interface ConfiguracaoTelegram {
  chat: string;
  usuario: string;
  credential?: string;
}

/** Resposta de um endpoint de configuração: status HTTP e corpo. */
export interface RespostaTelegram {
  status: number;
  body: unknown;
}

/** Dependências da configuração do Telegram. */
export interface PortasTelegram {
  /** A configuração guardada, se houver. */
  guardada(): Promise<ConfiguracaoTelegram | undefined>;
  /** Grava a configuração. */
  gravar(configuracao: ConfiguracaoTelegram): Promise<void>;
  /** A credencial está cadastrada no cofre? */
  credencialCadastrada(nome: string): Promise<boolean>;
  /** Religa a interface do Telegram com a configuração nova. */
  reiniciar(): Promise<void>;
}

/** Configuração salva, ou 404 se o Telegram ainda não foi configurado. */
export async function obterConfiguracao(portas: PortasTelegram): Promise<RespostaTelegram> {
  const salvo = await portas.guardada();
  return salvo ? { status: 200, body: salvo } : { status: 404, body: { error: "Telegram não configurado" } };
}

/**
 * Salva a configuração do Telegram. A conversa é um id numérico (pode ser negativo), o usuário autorizado é numérico, e
 * a credencial, se informada, precisa estar cadastrada. Salvar religa a interface para ler a configuração nova.
 */
export async function salvarConfiguracao(portas: PortasTelegram, corpo: unknown): Promise<RespostaTelegram> {
  const dados = corpo as { chat?: unknown; credential?: unknown; usuario?: unknown } | undefined;
  if (typeof dados?.chat !== "string" || !/^-?\d+$/.test(dados.chat.trim()))
    return { status: 400, body: { error: "informe chat, o id numérico da conversa do bot" } };
  if (typeof dados.usuario !== "string" || !/^\d+$/.test(dados.usuario.trim()))
    return {
      status: 400,
      body: { error: "informe usuario, o id numérico do usuário autorizado a falar com a fábrica" },
    };
  const credential = typeof dados.credential === "string" ? dados.credential.trim() : undefined;
  if (credential !== undefined && !(await portas.credencialCadastrada(credential)))
    return { status: 400, body: { error: `credencial ${credential} não cadastrada` } };
  const configuracao: ConfiguracaoTelegram = {
    chat: dados.chat.trim(),
    usuario: dados.usuario.trim(),
    ...(credential ? { credential } : {}),
  };
  await portas.gravar(configuracao);
  await portas.reiniciar();
  return { status: 200, body: configuracao };
}
