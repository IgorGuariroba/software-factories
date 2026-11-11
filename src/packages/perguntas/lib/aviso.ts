import { teamsQuestionMessage } from "../../../question-review.js";
import type { EventoPergunta, PortasPerguntas } from "./portas.js";

/**
 * Aviso ao PO no Teams sobre uma pergunta. A reserva acontece antes do envio, no mesmo estado: uma falha ambígua ou um
 * reinício nunca repetem o aviso sozinhos. O resultado incerto fica registrado e vira evento de erro.
 */
export async function avisarTeams(
  portas: PortasPerguntas,
  tarefaId: string,
  projetoNome: string,
  chave: string,
  n: number,
): Promise<void> {
  const avisoTeams = portas.avisoTeams;
  const projeto = portas.projeto(projetoNome);
  if (!avisoTeams || !projeto || projeto.dryRun) return;
  if (projeto.chavesDaFonte && !projeto.chavesDaFonte.includes(chave)) return;

  let aviso: { userId: string; link: string; title: string; nome?: string } | undefined;
  await portas.alterar((state) => {
    const tarefa = state.tasks.find((t) => t.id === tarefaId);
    if (
      state.daemonPaused ||
      !tarefa ||
      tarefa.pauseRequested ||
      portas.projetoPausado(state, tarefa.project) ||
      !["ativa", "aguardando-humano"].includes(tarefa.status)
    )
      return;
    const q = tarefa.questions?.find((item) => item.n === n);
    if (q?.teamsNotice?.status !== "pending" || q.answer !== null) return;
    const po = projeto.pessoaPO(q.to);
    if (!po || po.identidadeTeams !== q.teamsNotice.userId) return;
    q.teamsNotice.status = "attempted";
    aviso = { userId: q.teamsNotice.userId, link: q.teamsNotice.link, title: tarefa.title, nome: po.nome };
  });
  if (!aviso) return;
  const reservado: { userId: string; link: string; title: string; nome?: string } = aviso;
  try {
    await avisoTeams(
      reservado.userId,
      teamsQuestionMessage({ card: chave, title: reservado.title, link: reservado.link, name: reservado.nome }),
    );
    await marcarAviso(portas, tarefaId, n, "sent");
  } catch {
    await marcarAviso(portas, tarefaId, n, "uncertain");
    const erro: EventoPergunta = {
      type: "error",
      project: projetoNome,
      target: chave,
      message: "aviso Teams não confirmado; verifique o chat antes de tentar novamente",
    };
    await portas.registrarEvento(erro);
  }
}

async function marcarAviso(
  portas: PortasPerguntas,
  tarefaId: string,
  n: number,
  status: "sent" | "uncertain",
): Promise<void> {
  await portas.alterar((state) => {
    const q = state.tasks.find((t) => t.id === tarefaId)?.questions?.find((item) => item.n === n);
    if (q?.teamsNotice) q.teamsNotice.status = status;
  });
}
