import { RASCUNHO_PERGUNTA, SEM_CONTEUDO, TOQUE_RESPONDER } from "./mensagem.js";

/** Mensagem de gestão como o envelope a enxerga: texto e botões opcionais (estrutural, sem importar a ponte). */
export interface MensagemEnvelope {
  text: string;
  buttons?: { label: string; command: string }[];
}

/** Filas legadas sem `source`: em minimal, não reenvia o texto full persistido. */
export function envelopeMinimoLegado(item: { project: string; message: MensagemEnvelope }): MensagemEnvelope {
  const labeled = item.message.text.match(/^(\[[^\]]+\]\s*)?/);
  const prefix = labeled?.[1] ?? "";
  const bare = item.message.text.slice(prefix.length);
  const question = /^(Pergunta(?: pendente)? \d+ sobre \S+ \(\S+\))(?::|\.)([\s\S]*)$/.exec(bare);
  if (question) {
    const body = question[2] ?? "";
    const draft = body.includes("Rascunho não enviado") ? RASCUNHO_PERGUNTA : "";
    const tip = body.includes("Toque em Responder") ? TOQUE_RESPONDER : "";
    return {
      text: `${prefix}${question[1]}${SEM_CONTEUDO}${draft}${tip}`,
      ...(item.message.buttons ? { buttons: item.message.buttons } : {}),
    };
  }
  const assumed = /^(Assumi o card \S+ \(\S+\))(?::|\.)([\s\S]*)$/.exec(bare);
  if (assumed) {
    return {
      text: `${prefix}${assumed[1]}.`,
      ...(item.message.buttons ? { buttons: item.message.buttons } : {}),
    };
  }
  const blocked = /^(A Tarefa \S+ \(\S+\) está bloqueada)(?::|\.)([\s\S]*)$/.exec(bare);
  if (blocked) return { text: `${prefix}${blocked[1]}.` };
  const guard = /^(Guardrail bloqueou \S+ em \S+ \(\S+\))(?::|\.)([\s\S]*)$/.exec(bare);
  if (guard) return { text: `${prefix}${guard[1]}.` };
  const aviso = /^Aviso:(.+)$/s.exec(bare);
  if (aviso)
    return {
      text: `${prefix}Aviso (conteúdo oculto) no projeto ${item.project}. Consulte a interface web local para ver o conteúdo.`,
    };
  return {
    text: `${prefix}Aviso do projeto ${item.project}. Consulte a interface web local para ver o conteúdo.`,
    ...(item.message.buttons ? { buttons: item.message.buttons } : {}),
  };
}
