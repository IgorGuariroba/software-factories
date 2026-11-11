// Entry point público das leituras de repositórios do GitHub: a listagem dos vínculos, o catálogo do App com o plugue e a
// importação de cada repositório, e o painel do App com a cobertura. Só leitura: nada muda aqui.

import type { PortasRepositoriosGitHub } from "./lib/leitura.js";
import * as leitura from "./lib/leitura.js";

export type {
  CatalogoGitHub,
  EstadoRepositorios,
  ImportacaoRepo,
  ItemRepo,
  PortasRepositoriosGitHub,
  ProjetoGitHub,
  VinculoRepo,
} from "./lib/leitura.js";

export interface RepositoriosGitHub {
  listar(): ReturnType<typeof leitura.listarRepos>;
  catalogo(): ReturnType<typeof leitura.catalogo>;
  painel(): ReturnType<typeof leitura.painel>;
}

export function criarRepositoriosGitHub(portas: PortasRepositoriosGitHub): RepositoriosGitHub {
  return {
    listar: () => leitura.listarRepos(portas),
    catalogo: () => leitura.catalogo(portas),
    painel: () => leitura.painel(portas),
  };
}
export { projetoDoRepositorio } from "./lib/leitura.js";
