import { createHash } from "node:crypto";
import { withAutomationMark } from "./effect-writer.js";

/** A aprovação é vinculada ao destino, ao conteúdo exato e ao modo de escrita mostrado na prévia. */
export function questionRevision(preview: {
  card: string;
  to: string;
  comment: string;
  teamsUserId: string | null;
  teamsMessage: string | null;
  dryRun: boolean;
}): string {
  return createHash("sha256").update(JSON.stringify(preview)).digest("hex");
}

/** Revisão de uma prévia qualquer: o hash do conteúdo exato mostrado. */
export function reviewRevision(preview: unknown): string {
  return createHash("sha256").update(JSON.stringify(preview)).digest("hex");
}

/** Aviso ao PO no Teams: quem, qual card (chave e título) e o link para responder no próprio card. */
export function teamsQuestionMessage(n: { card: string; title: string; link: string; name?: string }): string {
  const first = n.name?.trim().split(/\s+/)[0];
  const greeting = first ? `Olá, ${first}!` : "Olá!";
  const what = n.title ? `${n.card} (${n.title})` : n.card;
  return withAutomationMark(
    `${greeting} Aguardamos a sua resposta à pergunta feita no card ${what}. Pode responder direto no card: ${n.link}`,
  );
}
