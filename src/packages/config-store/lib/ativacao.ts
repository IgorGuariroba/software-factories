import type { ProjectConfig } from "../../../config.js";
import { pessoasDoPapel } from "../../profiles/index.js";

/**
 * Estado do projeto como a interface mostra. `incompleto` não executa; `ativo` executa. `pausado` entra na fatia 09.
 */
export type EstadoProjeto = "incompleto" | "ativo";

/**
 * O que falta para o projeto ficar ativo (ADR-0022). Só avisos: a configuração salva mesmo incompleta, e a interface
 * lista as pendências. O comando de teste não aparece aqui porque o schema já o exige em todo repositório.
 */
export function pendenciasDeConfiguracao(config: ProjectConfig): string[] {
  const pendencias: string[] = [];
  if (!config.repositories || config.repositories.length === 0) pendencias.push("falta o repositório do projeto");
  if (pessoasDoPapel(config, "po").length === 0) pendencias.push("falta uma pessoa no perfil PO");
  if (pessoasDoPapel(config, "tech_lead").length === 0) pendencias.push("falta uma pessoa no perfil tech lead");
  if (config.source.type === "jira" && !config.source.credential) pendencias.push("Fonte Jira sem credencial no cofre");
  return pendencias;
}

/** Estado do projeto a partir das pendências: sem nenhuma, ativo. */
export function estadoDoProjeto(pendencias: string[]): EstadoProjeto {
  return pendencias.length === 0 ? "ativo" : "incompleto";
}
