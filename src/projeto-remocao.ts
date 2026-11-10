import type { FactoryState } from "./durable.js";
import type { ReservaDeProjeto } from "./projetos-github.js";

/**
 * Nomes e prefixos que projetos removidos ainda reservam (ticket 11). O nome fica reservado sempre; o prefixo, só
 * enquanto houver Tarefas do projeto no histórico (SPEC: "o prefixo fica reservado enquanto o histórico existir").
 */
export const projetosReservados = (state: Pick<FactoryState, "projetosRemovidos" | "tasks">): ReservaDeProjeto[] =>
  Object.entries(state.projetosRemovidos ?? {}).map(([nome, removido]) => ({
    nome,
    prefixo: state.tasks.some((t) => t.project === nome) ? removido.prefixo : undefined,
  }));

/** Um registro sem a chave `nome`: a remoção tira o projeto dos mapas por nome do estado. */
export const semProjeto = <T>(registro: Record<string, T> | undefined, nome: string): Record<string, T> =>
  Object.fromEntries(Object.entries(registro ?? {}).filter(([chave]) => chave !== nome));
