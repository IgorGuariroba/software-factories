import type { ProjectConfig } from "../../../config.js";
import { canalDaPessoa, identidadeTeams, pessoasDoPapel } from "../../profiles/index.js";

/**
 * Estado do projeto como a interface mostra. `incompleto` não executa; `ativo` executa; `pausado` não executa até o
 * usuário retomar (ticket 09).
 */
export type EstadoProjeto = "incompleto" | "ativo" | "pausado";

/**
 * O que falta para o projeto ficar ativo (ADR-0022). Só avisos: a configuração salva mesmo incompleta, e a interface
 * lista as pendências. Formatação não entra aqui: é opcional.
 */
export function pendenciasDeConfiguracao(config: ProjectConfig): string[] {
  const pendencias: string[] = [];
  if (!config.repositories || config.repositories.length === 0) pendencias.push("falta o repositório do projeto");
  if (pessoasDoPapel(config, "po").length === 0) pendencias.push("falta uma pessoa no perfil PO");
  if (pessoasDoPapel(config, "tech_lead").length === 0) pendencias.push("falta uma pessoa no perfil tech lead");
  if (config.source.type === "jira" && !config.source.credential) pendencias.push("Fonte Jira sem credencial no cofre");
  if (config.repositories?.some((r) => r.test.command.length === 0)) pendencias.push("falta o comando de teste");
  if (config.allowedProviders.length === 0) pendencias.push("falta um provedor permitido");
  // Canal Teams exige o identificador da pessoa no Teams (ticket 07): sem ele, o aviso não tem para onde ir.
  for (const pessoa of config.people) {
    if (canalDaPessoa(pessoa) === "teams" && !identidadeTeams(pessoa))
      pendencias.push(`falta o identificador no Teams de ${pessoa.name ?? pessoa.id}`);
  }
  return pendencias;
}

/**
 * Estado do projeto a partir das pendências: sem nenhuma, ativo. Um projeto pausado segue pausado até ser retomado, e
 * a retomada só o devolve a ativo se ainda não houver pendências.
 */
export function estadoDoProjeto(pendencias: string[], pausado = false): EstadoProjeto {
  if (pausado) return "pausado";
  return pendencias.length === 0 ? "ativo" : "incompleto";
}
