import { createHash } from "node:crypto";
import { AUTOMATION_PREFIX } from "./effect-writer.js";

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

export function teamsQuestionMessage(card: string, link: string): string {
  return `${AUTOMATION_PREFIX} Há uma pergunta para você no card ${card}. Responda no Jira: ${link}`;
}
