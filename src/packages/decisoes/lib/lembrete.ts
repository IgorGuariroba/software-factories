import { withAutomationMark } from "../../../marca-automacao.js";

import { reviewRevision } from "../../../question-review.js";

import { redactSecrets } from "../../../secrets.js";

import { textoDoLembrete } from "../../perguntas/index.js";
import { alterarPergunta, DRY_RUN, enviarOuVoltar, partesDoId, projetoDe, SEM_REVISAO } from "./comum.js";
import type { EventoDecisao, PortasDecisoes, RespostaDecisao, TarefaDecisoes } from "./portas.js";

export async function lembrete(
  portas: PortasDecisoes,
  id: string,
  n: number,
  aprovar: boolean,
  corpo: unknown,
): Promise<RespostaDecisao> {
  const { projectName, cardKey } = partesDoId(id);
  const estado = await portas.estado();
  const task: TarefaDecisoes | undefined = estado.tasks.find((t) => t.id === id);
  const q = task?.questions?.find((item) => item.n === n);
  if (!q) return { status: 404, body: { error: "pergunta não encontrada" } };
  if (q.reminder !== "draft" || q.answer !== null || task?.status !== "aguardando-humano")
    return { status: 409, body: { error: "lembrete não está disponível para aprovação" } };
  const projeto = projetoDe(portas, projectName);
  const texto = textoDoLembrete(q);
  const preview = {
    card: cardKey,
    to: q.to,
    comment: withAutomationMark(redactSecrets(`${projeto.formatMention(q.to)} ${texto}`)),
    dryRun: projeto.dryRun,
  };
  const revision = reviewRevision(preview);
  if (!aprovar) return { status: 200, body: { ...preview, revision } };
  const dados = corpo as { revision?: unknown } | undefined;
  if (dados?.revision !== revision) return SEM_REVISAO;
  if (projeto.dryRun) return DRY_RUN;
  const reservada = await portas.alterar((current) => {
    const tarefa = current.tasks.find((t) => t.id === id);
    const stored = tarefa?.questions?.find((item) => item.n === n);
    if (tarefa?.status !== "aguardando-humano" || stored?.reminder !== "draft" || stored.answer !== null) return false;
    stored.reminder = "sending";
    return true;
  });
  if (!reservada) return { status: 409, body: { error: "lembrete mudou ou já foi enviado" } };
  const envio = await enviarOuVoltar(
    portas,
    id,
    n,
    () => projeto.canal.remind(q.ref, texto),
    (stored) => {
      stored.reminder = "draft";
    },
  );
  if (!envio.enviado) return envio.resposta;
  await alterarPergunta(portas, id, n, (stored) => {
    stored.reminder = "sent";
  });
  const evento: EventoDecisao = {
    type: "question",
    project: projectName,
    target: cardKey,
    n,
    to: q.to,
    text: q.text,
    status: "lembrete",
  };
  await portas.registrarEvento(evento);
  return { status: 200, body: { ok: true } };
}
