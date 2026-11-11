/** Efeito de uma entrega do webhook: abortar a execução de uma Tarefa, ou avisar o usuário. */
export type EfeitoWebhook<Motivo extends string = string> =
  | { type: "abortar"; id: string }
  | { type: "notificar"; project: string; target: string; reason: Motivo; message: string };

/** Dependências da execução dos efeitos. */
export interface PortasEfeitos<Motivo extends string = string> {
  /** Id da execução durável da Tarefa, se ela já tem uma (`null`/`undefined`: não há o que abortar). */
  execucaoDe(tarefaId: string): Promise<number | null | undefined>;
  abortar(idExecucao: number): Promise<void>;
  notificar(efeito: Extract<EfeitoWebhook<Motivo>, { type: "notificar" }>): Promise<void>;
}

/**
 * Executa os efeitos de uma entrega do webhook em ordem. Abortar só alcança execução que existe: uma Tarefa ainda sem
 * execução durável não tem o que parar. Os avisos seguem para o canal de notificação.
 */
export async function executarEfeitosWebhook<Motivo extends string>(
  portas: PortasEfeitos<Motivo>,
  efeitos: EfeitoWebhook<Motivo>[],
): Promise<void> {
  for (const efeito of efeitos) {
    if (efeito.type === "abortar") {
      const execucao = await portas.execucaoDe(efeito.id);
      if (execucao !== null && execucao !== undefined) await portas.abortar(execucao);
      continue;
    }
    await portas.notificar(efeito);
  }
}
