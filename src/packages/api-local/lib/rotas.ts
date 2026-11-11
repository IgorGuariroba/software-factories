import type { FactoryCommands } from "./comandos.js";
import type { Rota } from "./despacho.js";
import type { Definicao } from "./rotas-comum.js";
import { DEFINICOES_PROJETOS } from "./rotas-projetos.js";
import { DEFINICOES_SISTEMA } from "./rotas-sistema.js";
import { DEFINICOES_TAREFAS } from "./rotas-tarefas.js";

const DEFINICOES: Definicao[] = [...DEFINICOES_SISTEMA, ...DEFINICOES_PROJETOS, ...DEFINICOES_TAREFAS];

/** As rotas do adaptador, ligadas aos comandos da fábrica. */
export function criarRotasApi(comandos: FactoryCommands): Rota[] {
  return DEFINICOES.map((d) => ({
    metodo: d.metodo,
    caminho: d.caminho,
    documentada: d.documentada,
    manipular: (pedido, capturas) => d.criar(comandos)(pedido, capturas),
  }));
}

/** Método e caminho documentado de cada rota do adaptador, sem ligar manipuladores. */
export function rotasDocumentadas(): { metodo: Rota["metodo"]; documentada: string }[] {
  return DEFINICOES.map(({ metodo, documentada }) => ({ metodo, documentada }));
}
