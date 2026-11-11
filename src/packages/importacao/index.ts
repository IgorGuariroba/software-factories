// Entry point público do módulo de Importação: a fila de importações de repositórios do GitHub App. Uma por vez, em ordem,
// separada da fila de buscas. Cada item relê o estado antes de rodar, para não repetir um repositório que já terminou.
import { executarImportacao } from "./lib/importar.js";
import type { PortasImportacao } from "./lib/portas.js";

export type {
  AlvoImportacao,
  EstadoImportacao,
  PortasImportacao,
  RegistroImportacao,
  RepoDoApp,
  ResultadoImportacao,
} from "./lib/portas.js";

export interface Importacao {
  /** Enfileira a importação de um repositório; o resultado vai para o estado, não para quem chamou. */
  enfileirar(repoId: number): void;
  /** Espera a fila esvaziar (para testes e para o encerramento limpo do daemon). */
  ociosa(): Promise<void>;
}

export function criarImportacao<Issue, Efeito>(portas: PortasImportacao<Issue, Efeito>): Importacao {
  let fila: Promise<void> = Promise.resolve();
  return {
    enfileirar(repoId) {
      fila = fila
        .then(() => executarImportacao(portas, repoId))
        .catch((err) => console.error("[fábrica] importação falhou:", portas.redigir(String(err))));
    },
    ociosa: () => fila,
  };
}
export { importacoesParaRetomar } from "./lib/retomada.js";
