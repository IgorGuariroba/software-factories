// Entry point público das ações humanas sobre uma Tarefa: esquecer a memória de uma etapa, e prévia e aplicação do reparo
// de uma Tarefa bloqueada. As regras (etapas permitidas, revisão exata, aprovação explícita) são do módulo; o estado, o
// reparo e o progresso são portas.
import { aplicarReparo, esquecerMemoria, previaReparo } from "./lib/acoes.js";
import type { PortasAcoes } from "./lib/portas.js";

export type { PortasAcoes, RespostaAcao, TarefaAcoes } from "./lib/portas.js";

export interface Acoes {
  esquecerMemoria(id: string, etapa: string): ReturnType<typeof esquecerMemoria>;
  previaReparo(id: string): ReturnType<typeof previaReparo>;
  aplicarReparo(id: string, corpo: unknown): ReturnType<typeof aplicarReparo>;
}

export function criarAcoes(portas: PortasAcoes): Acoes {
  return {
    esquecerMemoria: (id, etapa) => esquecerMemoria(portas, id, etapa),
    previaReparo: (id) => previaReparo(portas, id),
    aplicarReparo: (id, corpo) => aplicarReparo(portas, id, corpo),
  };
}
