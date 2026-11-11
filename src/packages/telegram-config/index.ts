// Entry point público da configuração do Telegram: obter e salvar a conversa do bot, o usuário autorizado e a credencial
// do token. A validação e o reinício da interface são do módulo; o estado e o cofre são portas.

import type { PortasTelegram } from "./lib/configuracao.js";
import * as configuracao from "./lib/configuracao.js";

export type { ConfiguracaoTelegram, PortasTelegram, RespostaTelegram } from "./lib/configuracao.js";

export interface ConfiguracaoTelegramModulo {
  obter(): ReturnType<typeof configuracao.obterConfiguracao>;
  salvar(corpo: unknown): ReturnType<typeof configuracao.salvarConfiguracao>;
}

export function criarConfiguracaoTelegram(portas: PortasTelegram): ConfiguracaoTelegramModulo {
  return {
    obter: () => configuracao.obterConfiguracao(portas),
    salvar: (corpo) => configuracao.salvarConfiguracao(portas, corpo),
  };
}
export {
  type ConfiguracaoSalva,
  type InterfaceSalva,
  interfaceSalvaVigente,
  reiniciaAposSalvar,
} from "./lib/interface.js";
