/** Fase de um ticket no TDD: o teste que falha (RED) e a implementação que o faz passar (GREEN). */
export type FaseTdd = "teste" | "implementacao";

/** Passo do TDD: um ticket numa fase. */
export interface PassoTdd {
  ticket: number;
  phase: FaseTdd;
}

/** Progresso do TDD como as regras o enxergam: commits aceitos, tickets verificados e o contador de recusas. */
export interface ProgressoTdd {
  commits: (PassoTdd & { sha: string })[];
  verifiedTickets?: { ticket: number }[] | null;
  head: string | null;
  pushed: boolean;
  requests: number;
  rejections: number;
  feedback: string | null;
}

/** Recusas da mesma fase antes de a Tarefa bloquear. */
export const MAX_RECUSAS_TDD = 3;

/** Os passos do TDD na ordem: teste e implementação de cada ticket. */
export function passosDoTdd(quantidadeDeTickets: number): PassoTdd[] {
  return Array.from({ length: quantidadeDeTickets }, (_, ticket) =>
    (["teste", "implementacao"] as const).map((phase) => ({ ticket, phase })),
  ).flat();
}

/** O passo já está feito: há commit dele, ou o ticket inteiro já foi verificado. */
export function passoFeito(progresso: ProgressoTdd, passo: PassoTdd): boolean {
  return (
    progresso.commits.some((c) => c.ticket === passo.ticket && c.phase === passo.phase) ||
    (progresso.verifiedTickets?.some((c) => c.ticket === passo.ticket) ?? false)
  );
}

/** O primeiro passo ainda não feito, na ordem do TDD. */
export function proximoPasso(passos: PassoTdd[], progresso: ProgressoTdd): PassoTdd | undefined {
  return passos.find((passo) => !passoFeito(progresso, passo));
}

/** Registra um commit aceito: avança o HEAD e zera o que a recusa deixou para trás. */
export function registrarCommitAceito(progresso: ProgressoTdd, passo: PassoTdd, sha: string): void {
  progresso.commits.push({ ...passo, sha });
  progresso.head = sha;
  progresso.pushed = false;
  progresso.requests++;
  progresso.rejections = 0;
  progresso.feedback = null;
}

/** Registra uma recusa do veredito: conta o pedido e a recusa, e guarda o feedback para a próxima tentativa. */
export function registrarRecusaTdd(progresso: ProgressoTdd, feedback: string): void {
  progresso.requests++;
  progresso.rejections++;
  progresso.feedback = feedback;
}

/** Esgotou as recusas da fase? Então a Tarefa bloqueia. */
export function recusasEsgotadas(progresso: ProgressoTdd): boolean {
  return progresso.rejections >= MAX_RECUSAS_TDD;
}
