import { addBusinessHours, workdayHours } from "../../../business-hours.js";
import { withAutomationMark } from "../../../marca-automacao.js";
import { questionRevision, teamsQuestionMessage } from "../../../question-review.js";
import { redactSecrets } from "../../../secrets.js";
import { HORAS_ATE_LEMBRETE } from "../../perguntas/index.js";
import { alterarPergunta, DRY_RUN, enviarOuVoltar, partesDoId, projetoDe, SEM_REVISAO } from "./comum.js";
import type { EventoDecisao, PortasDecisoes, RespostaDecisao } from "./portas.js";

/** Lembrete de pergunta: prévia (GET) e envio (POST). */
/** Pergunta de negócio ao PO: prévia (GET) e publicação no canal (POST), com trava contra envio duplo. */
export async function pergunta(
  portas: PortasDecisoes,
  travas: Set<string>,
  id: string,
  n: number,
  aprovar: boolean,
  corpo: unknown,
): Promise<RespostaDecisao> {
  const { projectName, cardKey } = partesDoId(id);
  const trava = `${id}/${n}`;
  if (travas.has(trava)) return { status: 409, body: { error: "pergunta já está sendo publicada" } };
  if (aprovar) travas.add(trava);
  try {
    const estado = await portas.estado();
    const task = estado.tasks.find((t) => t.id === id);
    const q = task?.questions?.find((item) => item.n === n);
    if (!q) return { status: 404, body: { error: "pergunta não encontrada" } };
    if (q.publication !== "draft" || task?.status !== "aguardando-humano")
      return { status: 409, body: { error: "pergunta não está disponível para aprovação" } };
    const projeto = projetoDe(portas, projectName);
    const po = projeto.pessoaPO(q.to);
    if (!po) return { status: 409, body: { error: "destinatário não está configurado" } };
    const link = projeto.baseUrl
      ? `${projeto.baseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(cardKey)}`
      : undefined;
    const preview = {
      card: cardKey,
      to: q.to,
      comment: withAutomationMark(redactSecrets(`${projeto.formatMention(q.to)} Pergunta ${n}: ${q.text}`)),
      teamsUserId: po.teamsUserId ?? null,
      teamsMessage:
        po.teamsUserId && link
          ? teamsQuestionMessage({ card: cardKey, title: task?.title ?? "", link, name: po.nome })
          : null,
      dryRun: projeto.dryRun,
    };
    const revision = questionRevision(preview);
    if (!aprovar) return { status: 200, body: { ...preview, revision } };
    const dados = corpo as { revision?: unknown } | undefined;
    if (dados?.revision !== revision) return SEM_REVISAO;
    if (projeto.dryRun) return DRY_RUN;
    if (estado.daemonPaused || task.pauseRequested) return { status: 409, body: { error: "tarefa ou daemon pausado" } };
    if (po.teamsUserId && (!link || !portas.teamsDisponivel))
      return { status: 409, body: { error: "Teams indisponível" } };
    const reservada = await portas.alterar((atual) => {
      const current = atual.tasks.find((t) => t.id === id);
      const currentQuestion = current?.questions?.find((item) => item.n === n);
      if (
        atual.daemonPaused ||
        (current && portas.projetoPausado(atual, current.project)) ||
        current?.status !== "aguardando-humano" ||
        current.pauseRequested ||
        currentQuestion?.publication !== "draft" ||
        currentQuestion.text !== q.text ||
        currentQuestion.to !== q.to
      )
        return false;
      currentQuestion.publication = "sending";
      return true;
    });
    if (!reservada) return { status: 409, body: { error: "pergunta mudou ou foi cancelada" } };
    const envio = await enviarOuVoltar(
      portas,
      id,
      n,
      () => projeto.canal.ask({ card: cardKey, to: q.to, text: `Pergunta ${n}: ${q.text}` }),
      (stored) => {
        stored.publication = "draft";
      },
    );
    if (!envio.enviado) return envio.resposta;
    const ref = envio.valor;
    const perguntadoEm = portas.agora();
    await alterarPergunta(portas, id, n, (stored) => {
      stored.ref = ref;
      stored.askedAt = perguntadoEm;
      stored.remindAt = addBusinessHours(projeto.calendario, perguntadoEm, HORAS_ATE_LEMBRETE);
      stored.notifyAt = addBusinessHours(projeto.calendario, perguntadoEm, workdayHours(projeto.calendario));
      stored.teamsNotice = po.teamsUserId && link ? { userId: po.teamsUserId, link, status: "pending" } : undefined;
      stored.publication = "sent";
    });
    await portas.avisarTeams(id, projectName, cardKey, n);
    const evento: EventoDecisao = {
      type: "question",
      project: projectName,
      target: cardKey,
      n,
      to: q.to,
      text: q.text,
      status: "enviada",
    };
    await portas.registrarEvento(evento);
    return { status: 200, body: { ok: true } };
  } finally {
    if (aprovar) travas.delete(trava);
  }
}
