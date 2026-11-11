// Entry point público do controle de Tarefas pelo usuário: pausar, retomar, cancelar, vetar, pausar o daemon e reordenar a
// fila. As regras de estado (quando pausa, o que a retomada destrava, o prazo do veto) são do módulo; o estado, a
// execução durável e o relógio são portas.
import * as controle from "./lib/controle.js";
import type { PortasControle } from "./lib/portas.js";

export type {
  EstadoControle,
  PortasControle,
  ResultadoVeto,
  TarefaControle,
  TipoDeBloqueio,
} from "./lib/portas.js";
export { TERMINAIS } from "./lib/portas.js";

export interface ControleTarefas {
  pausar(id: string): Promise<boolean>;
  retomar(id: string): Promise<boolean>;
  cancelar(id: string): Promise<boolean>;
  vetar(id: string): ReturnType<typeof controle.vetar>;
  pausarDaemon(paused: boolean): Promise<void>;
  reordenar(ids: string[]): Promise<void>;
}

export function criarControleTarefas(portas: PortasControle): ControleTarefas {
  return {
    pausar: (id) => controle.pausar(portas, id),
    retomar: (id) => controle.retomar(portas, id),
    cancelar: (id) => controle.cancelar(portas, id),
    vetar: (id) => controle.vetar(portas, id),
    pausarDaemon: (paused) => controle.pausarDaemon(portas, paused),
    reordenar: (ids) => controle.reordenar(portas, ids),
  };
}
export { decidirInspecao, type FatosInspecao, type ResultadoInspecao } from "./lib/inspecao.js";
export { type PortasReinspecao, type ResultadoReinspecao, reinspecionarVetos } from "./lib/reinspecao.js";
