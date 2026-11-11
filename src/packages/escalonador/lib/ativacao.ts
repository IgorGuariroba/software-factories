/** Estados em que a Tarefa espera para ser ativada. */
export const ESTADOS_QUE_ESPERAM_ATIVACAO = ["enfileirada", "aguardando-entrega"];

/** Tarefa como a ativação a enxerga: o status e as referências de execução que ela muda. */
export interface TarefaAtivacao {
  id: string;
  project: string;
  key: string;
  status: string;
  notBefore: number | null;
  durableId: number | null;
  gateId: number | null;
}

/** Parte do estado que a ativação lê e grava. */
export interface EstadoAtivacao {
  tasks: TarefaAtivacao[];
}

/** Identidade da Tarefa para a execução durável. */
export interface AlvoExecucao {
  id: string;
  project: string;
  key: string;
}

/** Dependências da ativação. */
export interface PortasAtivacao {
  /**
   * Altera o estado numa transação durável. `criarExecucao` cria a execução durável da Tarefa dentro dessa transação e
   * devolve o id dela.
   */
  alterar(
    fn: (estado: EstadoAtivacao, criarExecucao: (alvo: AlvoExecucao) => Promise<number>) => Promise<void>,
  ): Promise<void>;
  /** Abre (aborta) o portão em que a Tarefa esperava, para ela seguir. */
  abrirPortao(idPortao: number): Promise<void>;
}

/**
 * Ativa a Tarefa: só uma por vez, e só a partir de `enfileirada` ou `aguardando-entrega`. Se ela esperava num portão,
 * o portão é aberto; senão, nasce a execução durável. A checagem fica dentro da transação, então duas ativações
 * simultâneas não ativam a mesma Tarefa.
 */
export async function ativarTarefa(portas: PortasAtivacao, id: string): Promise<void> {
  let portaoParaAbrir: number | null = null;
  await portas.alterar(async (estado, criarExecucao) => {
    const tarefa = estado.tasks.find((t) => t.id === id);
    if (
      !tarefa ||
      !ESTADOS_QUE_ESPERAM_ATIVACAO.includes(tarefa.status) ||
      estado.tasks.some((t) => t.status === "ativa")
    )
      return;
    tarefa.status = "ativa";
    tarefa.notBefore = null;
    if (tarefa.gateId !== null) {
      portaoParaAbrir = tarefa.gateId;
      tarefa.gateId = null;
    } else {
      tarefa.durableId = await criarExecucao({ id: tarefa.id, project: tarefa.project, key: tarefa.key });
    }
  });
  if (portaoParaAbrir !== null) await portas.abrirPortao(portaoParaAbrir);
}
