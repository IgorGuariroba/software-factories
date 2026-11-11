import type { PortasAcoes, RespostaAcao, TarefaAcoes } from "./portas.js";

const NAO_ENCONTRADA = (id: string): RespostaAcao => ({ status: 404, body: { error: `Tarefa ${id} não existe` } });

/** Etapas em que a memória pode ser esquecida: a SPEC, a revisão, e cada retrô (`retro:<etapa>`). */
function conversaDaEtapa(tarefa: TarefaAcoes, etapa: string): { conversa?: string; retro?: string } | "nao-permitida" {
  if (etapa === "spec") return { conversa: tarefa.specConversationId ?? undefined };
  if (etapa === "review") return { conversa: tarefa.review?.conversationId ?? undefined };
  if (etapa.startsWith("retro:") && etapa.length > "retro:".length) {
    const retro = etapa.slice("retro:".length);
    return { conversa: tarefa.retros?.find((r) => r.stage === retro)?.conversationId ?? undefined, retro };
  }
  return "nao-permitida";
}

/**
 * Esquece a memória de uma etapa: a conversa sai do contexto e não volta a ser retomada. A implementação não entra aqui:
 * as tools dela localizam a Tarefa pelo id da conversa, e zerá-lo quebraria a retomada.
 */
export async function esquecerMemoria(portas: PortasAcoes, id: string, etapa: string): Promise<RespostaAcao> {
  const tarefa = await portas.tarefa(id);
  if (!tarefa) return NAO_ENCONTRADA(id);
  const resolvida = conversaDaEtapa(tarefa, etapa);
  if (resolvida === "nao-permitida")
    return { status: 409, body: { error: `a etapa ${etapa} ainda não permite esquecer a memória` } };
  if (!resolvida.conversa)
    return { status: 409, body: { error: `a etapa ${etapa} ainda não tem memória para esquecer` } };
  const conversa = resolvida.conversa;
  const retro = resolvida.retro;
  await portas.alterar(id, (alvo) => {
    alvo.conversasEsquecidas = [...(alvo.conversasEsquecidas ?? []), conversa];
    if (etapa === "spec") alvo.specConversationId = null;
    else if (etapa === "review" && alvo.review) alvo.review.conversationId = null;
    else if (retro) {
      const registro = alvo.retros?.find((r) => r.stage === retro);
      if (registro) registro.conversationId = null;
    }
  });
  return { status: 200, body: { etapa, esquecida: true } };
}

/** Prévia do reparo humano de uma Tarefa bloqueada. */
export async function previaReparo(portas: PortasAcoes, id: string): Promise<RespostaAcao> {
  const tarefa = await portas.tarefa(id);
  if (!tarefa) return { status: 404, body: { error: "tarefa inexistente" } };
  return { status: 200, body: await portas.previaReparo(tarefa) };
}

/**
 * Aplica o reparo aprovado. Exige a revisão exata (um hash) e a aprovação explícita dos reparos, inclusive nos testes.
 * Depois de integrado, registra o progresso: a Tarefa continua bloqueada até a retomada explícita.
 */
export async function aplicarReparo(portas: PortasAcoes, id: string, corpo: unknown): Promise<RespostaAcao> {
  const tarefa = await portas.tarefa(id);
  if (!tarefa) return { status: 404, body: { error: "tarefa inexistente" } };
  const dados = corpo as { revision?: unknown; approveTestChanges?: unknown } | undefined;
  if (
    typeof dados?.revision !== "string" ||
    !/^[0-9a-f]{64}$/.test(dados.revision) ||
    dados.approveTestChanges !== true
  )
    return {
      status: 400,
      body: { error: "exige revisão exata e aprovação explícita dos reparos, inclusive nos testes" },
    };
  const resultado = await portas.integrarReparo(id, dados.revision);
  await portas.registrarProgresso(
    id,
    `Reparo humano aprovado e validado para o ticket ${resultado.ticket + 1}: commit ${resultado.sha.slice(0, 8)}. Tarefa continua bloqueada até retomada explícita.`,
  );
  return { status: 200, body: resultado };
}
