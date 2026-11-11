import type { DesfechoEntrega, FeedbackPublicacao, PortasEtapa } from "./portas.js";

/** Quantos lotes de entrega uma etapa roda antes de devolver `acompanhar`. */
const LOTES_DE_ENTREGA = 3;

/**
 * Retoma o TDD pendente (correções que ficaram para trás numa interrupção) antes de exigir clone limpo para sincronizar
 * ou revisar. Devolve `true` se retomou uma implementação.
 */
export async function retomarCorrecoes(portas: PortasEtapa): Promise<boolean> {
  const interrompida = await portas.estado();
  if (!interrompida?.implementation || !interrompida.delivery) return false;
  const feitas = new Set<unknown>([
    ...interrompida.implementation.commits.filter((c) => c.phase === "implementacao").map((c) => c.ticket),
    ...(interrompida.implementation.verifiedTickets ?? []).map((c) => c.ticket),
  ]);
  const originais = interrompida.delivery.tickets.length;
  if (interrompida.correctionTickets?.some((_, indice) => !feitas.has(originais + indice))) {
    await portas.implementar();
    return true;
  }
  return false;
}

/**
 * Ciclo de revisão: revisa, registra o veredito e corrige enquanto a revisão pedir correção. `feedback` é o que as
 * pessoas comentaram na publicação e a revisão precisa considerar.
 */
export async function ciclarRevisao(portas: PortasEtapa, feedback: FeedbackPublicacao[] = []): Promise<void> {
  await retomarCorrecoes(portas);
  await portas.sincronizarBase();
  for (;;) {
    const veredito = await portas.revisar(feedback);
    const revisada = (await portas.estado())?.review;
    if (veredito && revisada)
      await portas.progresso(
        `Review ${veredito} do HEAD ${revisada.head.slice(0, 8)}: ${revisada.summary.slice(0, 400)}`,
        true,
      );
    if (veredito !== "corrigir") return;
    await portas.implementar();
  }
}

/**
 * Etapa de entrega: publica a PR/MR em lotes. Antes de cada publicação, retoma correções e revisa se a PR/MR ainda está
 * aberta. Se a entrega pede revisão (feedback das pessoas), revisa com esse feedback, marca-o como levado em conta e
 * tenta de novo. Um bloqueio vira progresso e segue como erro para a fila.
 */
export async function executarEntrega(portas: PortasEtapa): Promise<"acompanhar" | undefined> {
  for (let lote = 0; lote < LOTES_DE_ENTREGA; lote++) {
    let desfecho: DesfechoEntrega;
    try {
      const situacao = await situacaoDaRequisicao(portas);
      if (situacao === undefined || situacao === "open") {
        const retomou = await retomarCorrecoes(portas);
        if ((await portas.sincronizarBase()) || retomou) await ciclarRevisao(portas);
      }
      desfecho = await portas.entregar();
    } catch (erro) {
      // Bloqueio na entrega (ex.: CI reprovada): o motivo aparece no progresso e o bloqueio segue.
      const motivo = portas.mensagemDeBloqueio(erro);
      if (motivo !== undefined) await portas.progresso(`Entrega bloqueada: ${portas.redigir(motivo)}`);
      else await registrarProgressoDaPublicacao(portas);
      throw erro;
    }
    await registrarProgressoDaPublicacao(portas);
    if (desfecho !== "revisar") return desfecho;
    const feedback = (await portas.estado())?.publication?.pendingFeedback ?? [];
    await ciclarRevisao(portas, feedback);
    await portas.alterar((tarefa) => {
      const publicacao = tarefa.publication;
      if (publicacao) {
        publicacao.feedbackIds = [...new Set([...publicacao.feedbackIds, ...feedback.map((f) => f.id)])];
        publicacao.pendingFeedback = [];
      }
    });
  }
  return "acompanhar";
}

async function registrarProgressoDaPublicacao(portas: PortasEtapa): Promise<void> {
  const publicacao = (await portas.estado())?.publication;
  if (publicacao) await portas.progresso(`PR/MR ${publicacao.status}${publicacao.url ? `: ${publicacao.url}` : ""}`);
}

/**
 * Situação remota da PR/MR da Tarefa. Só se consulta quando há PR/MR e implementação, e não em modo de ensaio. Sem
 * consulta possível, `undefined` (a entrega segue como se a PR/MR estivesse aberta).
 */
export async function situacaoDaRequisicao(portas: PortasEtapa): Promise<string | undefined> {
  if (portas.emEnsaio()) return undefined;
  const requisicao = await portas.requisicaoDaTarefa();
  if (!requisicao?.numero || !requisicao.worktree) return undefined;
  return portas.consultarRequisicao(requisicao.worktree, requisicao.numero);
}
