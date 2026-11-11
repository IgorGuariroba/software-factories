import { estadoDoProjeto, lerConfiguracao, pendenciasDeConfiguracao } from "../../config-store/index.js";
import type { EstadoProjetos, PortasProjetos, Resposta } from "./portas.js";

/** Tira uma chave de um registro por nome de projeto. */
const semChave = <T>(registro: Record<string, T> | undefined, nome: string): Record<string, T> =>
  Object.fromEntries(Object.entries(registro ?? {}).filter(([chave]) => chave !== nome));

/**
 * Marca ou desmarca a pausa de um projeto, sem validar a configuração. Ao retomar, as Tarefas paradas só pela pausa
 * do projeto voltam para a fila; as pausadas pelo usuário ficam paradas.
 */
export async function marcarPausa(portas: PortasProjetos, nome: string, pausado: boolean): Promise<void> {
  await portas.estado.alterar((state) => {
    if (pausado) {
      state.projetosPausados = [...new Set([...(state.projetosPausados ?? []), nome])];
      return;
    }
    state.projetosPausados = (state.projetosPausados ?? []).filter((p) => p !== nome);
    for (const t of state.tasks)
      if (t.project === nome && t.status === "pausada" && !t.pauseRequested) t.status = "enfileirada";
  });
}

/** Pendências da configuração guardada do projeto, com a confirmação de troca de Fonte. */
async function pendenciasDoGuardado(
  portas: PortasProjetos,
  nome: string,
  state: EstadoProjetos,
): Promise<{ configurado: boolean; pendencias: string[] }> {
  const guardada = lerConfiguracao(state.projetos?.[nome]);
  if (!guardada) return { configurado: false, pendencias: [] };
  return {
    configurado: true,
    pendencias: portas.regras.comConfirmacaoPendente(pendenciasDeConfiguracao(guardada), state, nome),
  };
}

/** Pausa um projeto. Só um projeto ativo se pausa: um incompleto já não executa (ADR-0022). */
export async function pausar(portas: PortasProjetos, nome: string): Promise<Resposta> {
  return alterarPausa(portas, nome, true);
}

/** Retoma um projeto pausado. Volta a ativo só sem pendências; senão segue pausado com o que falta. */
export async function retomar(portas: PortasProjetos, nome: string): Promise<Resposta> {
  return alterarPausa(portas, nome, false);
}

async function alterarPausa(portas: PortasProjetos, nome: string, pausar: boolean): Promise<Resposta> {
  const antes = await pendenciasDoGuardado(portas, nome, await portas.estado.ler());
  if (!antes.configurado) return { status: 404, body: { error: `projeto ${nome} não existe` } };
  if (antes.pendencias.length > 0)
    return { status: 409, body: { error: `projeto ${nome} incompleto: ${antes.pendencias.join("; ")}` } };
  await marcarPausa(portas, nome, pausar);
  const state = await portas.estado.ler();
  return {
    status: 200,
    body: {
      estado: estadoDoProjeto(antes.pendencias, portas.regras.projetoPausado(state, nome)),
      pendencias: antes.pendencias,
    },
  };
}

/**
 * Remove um projeto. Remover é irreversível: o nome precisa ser repetido em `confirmar`. Com Tarefa em andamento, nada
 * muda. O nome fica reservado, e o prefixo também enquanto houver histórico de Tarefas.
 */
export async function remover(portas: PortasProjetos, nome: string, confirmar: unknown): Promise<Resposta> {
  if (!(await portas.estado.ler()).projetos?.[nome])
    return { status: 404, body: { error: `projeto ${nome} não existe` } };
  if (confirmar !== nome)
    return {
      status: 400,
      body: { error: `confirme a remoção enviando "confirmar" com o nome do projeto: ${nome}` },
    };
  let emAndamento: string[] = [];
  let removido = false;
  await portas.estado.alterar((state) => {
    if (!state.projetos?.[nome]) return;
    // Com Tarefa em andamento, nada muda: a remoção só sai quando o projeto não tem nenhuma (ticket 11).
    emAndamento = portas.regras.tarefasEmAndamento(state, nome).map((t) => t.id);
    if (emAndamento.length > 0) return;
    const guardada = lerConfiguracao(state.projetos[nome]);
    removido = true;
    state.projetos = semChave(state.projetos, nome);
    state.projetosGitHub = semChave(state.projetosGitHub, nome);
    state.repos = semChave(state.repos, nome);
    state.sincronizadoEm = semChave(state.sincronizadoEm, nome);
    state.projetosPausados = (state.projetosPausados ?? []).filter((p) => p !== nome);
    state.projetosAguardandoConfirmacao = (state.projetosAguardandoConfirmacao ?? []).filter((p) => p !== nome);
    const quando = new Date(portas.agora()).toISOString();
    state.projetosRemovidos = {
      ...state.projetosRemovidos,
      [nome]: { prefixo: guardada?.source.project ?? "", quando },
    };
    state.historicoConfig = {
      ...state.historicoConfig,
      [nome]: [...(state.historicoConfig?.[nome] ?? []), { quando, autor: "usuario", campos: ["projeto removido"] }],
    };
    // Dentro da mesma transação: nenhuma Tarefa nova entra no projeto entre a gravação e a saída da memória.
    portas.fabrica.esquecer(nome);
  });
  if (emAndamento.length > 0)
    return {
      status: 409,
      body: {
        error: `há tarefas em andamento no projeto ${nome}: conclua ou cancele-as para remover o projeto`,
        tarefasEmAndamento: emAndamento,
      },
    };
  if (!removido) return { status: 404, body: { error: `projeto ${nome} não existe` } };
  const reserva = portas.regras.projetosReservados(await portas.estado.ler()).find((r) => r.nome === nome);
  return { status: 200, body: { removido: nome, prefixoReservado: reserva?.prefixo ?? null } };
}
