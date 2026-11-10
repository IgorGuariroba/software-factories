import type { ProjectConfig } from "./config.js";
import type { FactoryState } from "./durable.js";

/** Pendência enquanto a troca de Fonte ou de repositório não foi confirmada (ticket 10). */
export const PENDENCIA_CONFIRMAR_FONTE = "confirme a nova Fonte ou repositório";

/** O projeto trocou a Fonte ou o repositório e ainda não confirmou a configuração nova (ticket 10). */
export const aguardandoConfirmacao = (
  state: Pick<FactoryState, "projetosAguardandoConfirmacao">,
  project: string,
): boolean => state.projetosAguardandoConfirmacao?.includes(project) === true;

/** Acrescenta a pendência de confirmação às da configuração, quando a troca ainda não foi confirmada. */
export const comConfirmacaoPendente = (
  pendencias: string[],
  state: Pick<FactoryState, "projetosAguardandoConfirmacao">,
  project: string,
): string[] => (aguardandoConfirmacao(state, project) ? [...pendencias, PENDENCIA_CONFIRMAR_FONTE] : pendencias);

/**
 * A gravação troca a Fonte, ou o repositório de um caminho ou prefixo (o que liga o repositório aos cards). Comando de
 * teste, formatação e os demais campos do repositório não contam: mudá-los não troca o repositório.
 */
export const trocouFonteOuRepositorio = (antes: ProjectConfig, depois: ProjectConfig): boolean => {
  const ligacao = (config: ProjectConfig) => (config.repositories ?? []).map((r) => [r.path, r.prefix]);
  return (
    JSON.stringify(antes.source) !== JSON.stringify(depois.source) ||
    JSON.stringify(ligacao(antes)) !== JSON.stringify(ligacao(depois))
  );
};
