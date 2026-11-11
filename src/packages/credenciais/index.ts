// Entry point público do cofre de credenciais: troca o valor de uma credencial com as regras de uso por projetos (teste de
// conexão do Jira antes de trocar, histórico e reinício do Telegram). O cofre em si e a configuração ficam atrás de portas.
import { gravarCredencial } from "./lib/gravar.js";
import type { PortasCredenciais } from "./lib/portas.js";

export type {
  FonteDoProjeto,
  PortasCredenciais,
  RespostaCredencial,
  ResultadoConexao,
} from "./lib/portas.js";

export interface Credenciais {
  gravar(nome: string, corpo: unknown): ReturnType<typeof gravarCredencial>;
}

export function criarCredenciais(portas: PortasCredenciais): Credenciais {
  return { gravar: (nome, corpo) => gravarCredencial(portas, nome, corpo) };
}
