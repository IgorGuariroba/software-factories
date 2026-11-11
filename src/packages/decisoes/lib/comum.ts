import { GuardrailViolation } from "../../../marca-automacao.js";
import type { TriageResult } from "../../../triage.js";
import type { PerguntaDecisoes, PortasDecisoes, RespostaDecisao } from "./portas.js";

export const SEM_REVISAO = { status: 409, body: { error: "prévia alterada; revise novamente" } };
export const DRY_RUN = { status: 409, body: { error: "publicação real desativada no dry-run" } };

/** Número do card da duplicata, como `#123`, se a chave for de Jira/GitHub. */
export function referenciaDuplicata(result: TriageResult): string | undefined {
  const key = result.duplicateOf;
  return key && /-\d+$/.test(key) ? `#${key.slice(key.lastIndexOf("-") + 1)}` : undefined;
}

/** Como fechar a issue recusada. */
export function motivoDeFechamento(result: TriageResult): "completed" | "not_planned" | "duplicate" {
  if (result.closeAs) return result.closeAs;
  if (result.category === "duplicata") return "duplicate";
  if (result.category === "ja-feito" || result.category === "resolvida") return "completed";
  return "not_planned";
}

/** Projeto e chave do card a partir do id da Tarefa (`projeto/chave`). */
export function partesDoId(id: string): { projectName: string; cardKey: string } {
  const i = id.indexOf("/");
  return { projectName: id.slice(0, i), cardKey: id.slice(i + 1) };
}

export function projetoDe(portas: PortasDecisoes, nome: string) {
  const projeto = portas.projeto(nome);
  if (!projeto) throw new Error(`Projeto ${nome} não está configurado`);
  return projeto;
}

export async function alterarPergunta(
  portas: PortasDecisoes,
  id: string,
  n: number,
  mudar: (q: PerguntaDecisoes) => void,
): Promise<void> {
  await portas.alterar((estado) => {
    const pergunta = estado.tasks.find((t) => t.id === id)?.questions?.find((q) => q.n === n);
    if (pergunta) mudar(pergunta);
  });
}

/**
 * Envia uma escrita já reservada. Se o guardrail barra antes de escrever, nada saiu: `voltar` devolve o item a rascunho
 * e a resposta é 409. Qualquer outro erro propaga, porque o envio pode ter saído pela metade.
 */
export async function enviarOuVoltar<T>(
  portas: PortasDecisoes,
  id: string,
  n: number,
  enviar: () => Promise<T>,
  voltar: (stored: PerguntaDecisoes) => void,
): Promise<{ enviado: true; valor: T } | { enviado: false; resposta: RespostaDecisao }> {
  try {
    return { enviado: true, valor: await enviar() };
  } catch (err) {
    if (!(err instanceof GuardrailViolation)) throw err;
    await alterarPergunta(portas, id, n, voltar);
    return { enviado: false, resposta: { status: 409, body: { error: `publicação barrada: ${err.message}` } } };
  }
}
