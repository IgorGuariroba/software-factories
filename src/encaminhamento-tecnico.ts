import type { Channel, QuestionRef } from "./channel.js";
import type { ProjectConfig } from "./config.js";
import { validarDestinatarioDoProjeto } from "./destinatarios-projeto.js";
import type { FactoryState } from "./durable.js";
import type { EventRecorder } from "./events.js";
import { calcularPrazoUtil } from "./prazo-util.js";

export interface EncaminhamentoTecnico {
  status: "sending" | "sent" | "blocked" | "uncertain";
  to: string | null;
  reason: "nao-sei" | "prazo";
  at: number;
  ref?: QuestionRef;
}

export function prazoPerguntaTecnica(disponibilizadaEm: number): number {
  return calcularPrazoUtil({
    minutosUteis: 120,
    relogio: () => new Date(disponibilizadaEm),
  }).getTime();
}

interface Dependencias {
  config: ProjectConfig;
  channel: Channel;
  events: EventRecorder;
  now(): number;
  commit<T>(change: (state: FactoryState) => T): Promise<T>;
}

/** Os dois gatilhos compartilham a mesma reserva durável, antes do efeito externo. */
export async function encaminharPerguntaTecnica(deps: Dependencias, id: string, n: number): Promise<void> {
  const reserva = await deps.commit((state) => {
    const task = state.tasks.find((t) => t.id === id);
    const q = task?.questions?.find((pergunta) => pergunta.n === n);
    if (!task || !q || q.origin !== "tecnica" || q.answer !== null || q.forwarding) return undefined;
    if (!["aguardando-humano", "pausada"].includes(task.status)) return undefined;
    if (!q.needsForwarding && deps.now() < prazoPerguntaTecnica(q.askedAt)) return undefined;

    const lead = deps.config.people.find((p) => p.role === "tech_lead");
    const reason = q.needsForwarding ? "nao-sei" as const : "prazo" as const;
    q.forwarding = { status: lead ? "sending" : "blocked", to: lead?.id ?? null, reason, at: deps.now() };
    // Só valores independentes do rascunho saem do commit.
    return { card: task.key, text: q.text, to: lead?.id, reason };
  });
  if (!reserva) return;

  const avisarBloqueio = async () => {
    await deps.events.append({
      type: "notify",
      project: deps.config.name,
      target: reserva.card,
      reason: "pergunta-sem-resposta",
      message: `Encaminhamento da pergunta ${n} da tarefa ${id} bloqueado: tech lead ausente ou não autorizado nas pessoas do projeto ${deps.config.name}.`,
    });
  };
  if (!reserva.to) {
    await avisarBloqueio();
    return;
  }

  try {
    validarDestinatarioDoProjeto(deps.config.people.map((p) => p.id), reserva.to);
    if (!deps.config.people.some((p) => p.id === reserva.to && p.role === "tech_lead")) {
      throw new Error("Tech lead revogado");
    }
  } catch {
    await deps.commit((state) => {
      const q = state.tasks.find((t) => t.id === id)?.questions?.find((p) => p.n === n);
      if (q?.forwarding) q.forwarding.status = "blocked";
    });
    await avisarBloqueio();
    return;
  }

  let ref: QuestionRef;
  try {
    ref = await deps.channel.ask({
      card: reserva.card,
      to: reserva.to,
      text: `Encaminhamento técnico da tarefa ${id}, pergunta ${n} (${reserva.reason === "nao-sei" ? "usuário respondeu não sei" : "120 minutos úteis sem resposta"}):\n\n${reserva.text}`,
    });
  } catch {
    // Uma resposta perdida não prova que o envio falhou. Não repetir automaticamente.
    await deps.commit((state) => {
      const q = state.tasks.find((t) => t.id === id)?.questions?.find((p) => p.n === n);
      if (q?.forwarding) q.forwarding.status = "uncertain";
    });
    await deps.events.append({
      type: "error", project: deps.config.name, target: reserva.card,
      message: `Encaminhamento da pergunta ${n} ao tech lead não confirmado; verifique o Channel antes de reenviar.`,
    });
    return;
  }
  await deps.commit((state) => {
    const q = state.tasks.find((t) => t.id === id)?.questions?.find((p) => p.n === n);
    if (!q?.forwarding) return;
    q.forwarding.status = "sent";
    q.forwarding.ref = ref;
    q.needsForwarding = false;
  });
}
