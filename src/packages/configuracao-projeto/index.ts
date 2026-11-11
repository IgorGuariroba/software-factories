// Entry point público da configuração de projetos: leitura do estado e das pendências, confirmação da Fonte nova,
// histórico e salvamento. As regras (validação, troca de Fonte só sem Tarefas em andamento, histórico) são do módulo; o
// estado, o sistema de arquivos, a Fonte e a aplicação são portas.
import * as etapas from "./lib/configuracao.js";
import type { PortasConfiguracaoProjeto } from "./lib/portas.js";

export type {
  EstadoConfiguracao,
  PortasConfiguracaoProjeto,
  RegistroHistorico,
  RespostaConfiguracao,
} from "./lib/portas.js";

export interface ConfiguracaoProjetos {
  pendencias: (nome: string) => ReturnType<typeof etapas.pendencias>;
  estado: (nome: string) => ReturnType<typeof etapas.estado>;
  confirmarFonte: (nome: string) => ReturnType<typeof etapas.confirmarFonte>;
  historico: (nome: string) => ReturnType<typeof etapas.historico>;
  configuracao: (nome: string) => ReturnType<typeof etapas.configuracao>;
  salvar: (nome: string, corpo: unknown) => ReturnType<typeof etapas.salvar>;
}

export function criarConfiguracaoProjetos(portas: PortasConfiguracaoProjeto): ConfiguracaoProjetos {
  return {
    pendencias: (nome) => etapas.pendencias(portas, nome),
    estado: (nome) => etapas.estado(portas, nome),
    confirmarFonte: (nome) => etapas.confirmarFonte(portas, nome),
    historico: (nome) => etapas.historico(portas, nome),
    configuracao: (nome) => etapas.configuracao(portas, nome),
    salvar: (nome, corpo) => etapas.salvar(portas, nome, corpo),
  };
}
export { comCalendarioEfetivo } from "./lib/calendario.js";
export { type DecisaoCargaSalvo, decidirCargaDoSalvo } from "./lib/carga.js";
export { recriaFonte } from "./lib/fonte.js";
