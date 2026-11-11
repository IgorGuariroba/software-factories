import { avisarTeams } from "./aviso.js";
import type { EventoPergunta, PortasPerguntas } from "./portas.js";

/**
 * Confere, pelo Canal, a resposta de cada Tarefa que aguarda uma pessoa. Antes de conferir, manda o aviso ao Teams
 * pendente. Uma pergunta com erro vira evento e não impede as demais.
 */
export async function verificarRespostas(portas: PortasPerguntas): Promise<void> {
  const estado = await portas.estado();
  for (const tarefa of estado.tasks) {
    const pendente = tarefa.status === "aguardando-humano" ? portas.perguntaPendente(tarefa) : undefined;
    if (!pendente || pendente.publication === "draft" || pendente.publication === "sending") continue;
    try {
      const projeto = portas.projeto(tarefa.project);
      if (!projeto) throw new Error(`Projeto ${tarefa.project} não está configurado`);
      const agora = portas.agora();
      if (projeto.proximaAtividade(agora) > agora) continue;
      await avisarTeams(portas, tarefa.id, tarefa.project, tarefa.key, pendente.n);
      await conferirResposta(portas, tarefa.id, pendente.n);
    } catch (err) {
      const erro: EventoPergunta = {
        type: "error",
        project: tarefa.project,
        target: tarefa.key,
        message: `falha ao conferir a resposta: ${err instanceof Error ? err.message : String(err)}`,
      };
      await portas.registrarEvento(erro);
    }
  }
}

/**
 * Confere uma pergunta pelo Canal. Devolve `true` se a resposta chegou e foi registrada: quem chama (o escalonamento da
 * Tarefa) para de lembrar. Pergunta técnica não passa pelo Canal.
 */
export async function conferirResposta(portas: PortasPerguntas, tarefaId: string, n: number): Promise<boolean> {
  const estado = await portas.estado();
  const tarefa = estado.tasks.find((t) => t.id === tarefaId);
  const pergunta = tarefa?.questions?.find((q) => q.n === n);
  if (!tarefa || !pergunta || pergunta.origin === "tecnica") return false;
  const projeto = portas.projeto(tarefa.project);
  if (!projeto) return false;
  const resposta = await projeto.canal.answer(pergunta.ref);
  if (resposta === undefined) return false;
  const registrada = await portas.alterar((state) => portas.registrarResposta(state, tarefa.id, n, resposta));
  if (registrada)
    await portas.registrarEvento({
      type: "question",
      project: tarefa.project,
      target: tarefa.key,
      n,
      to: pergunta.to,
      text: pergunta.text,
      status: "respondida",
    });
  return true;
}
