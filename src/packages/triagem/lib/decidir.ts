import type { ConversationId } from "@earendil-works/pi-durable";
import { refusalComment } from "../../../triage.js";
import { TERMINAIS } from "../../controle-tarefa/index.js";
import { motivoDeFechamento, referenciaDuplicata } from "../../decisoes/index.js";
import type { AlvoTriagem, DesfechoTriagem, PortasTriagem, RegistroTriagem } from "./portas.js";

/** Cópia desligada do estado: a mesma que o módulo durável faz (JSON), para não compartilhar objetos entre transações. */
const copia = <T>(valor: T): T => JSON.parse(JSON.stringify(valor)) as T;

/**
 * Triagem da issue (ADR-0014), só nos repositórios monitorados. `aceita` segue (se houver vaga); `recusa` dá baixa (com
 * prévia se `triageApproval`); `duvidosa` espera a pessoa. Sem decisão, a Tarefa fica `aguardar` com o rascunho da
 * decisão, e a pessoa decide na página.
 */
export async function decidirTriagem(portas: PortasTriagem, alvo: AlvoTriagem): Promise<DesfechoTriagem> {
  const configuracao = portas.configuracao(alvo.project);
  if (!configuracao) return undefined;
  let registro: RegistroTriagem | null = null;
  let conversa: ConversationId | null = null;
  await portas.alterar((estado) => {
    const tarefa = estado.tasks.find((t) => t.id === alvo.id);
    registro = tarefa?.triage ? copia(tarefa.triage) : null;
    conversa = tarefa?.triageConversation ?? null;
  });
  if (!registro) {
    const result = await portas.avaliar(conversa);
    const novo: RegistroTriagem = { result, review: null };
    await portas.alterar((estado) => {
      const tarefa = estado.tasks.find((t) => t.id === alvo.id);
      if (tarefa && !tarefa.triage) tarefa.triage = novo;
    });
    registro = novo;
  }
  const { result, review } = registro as RegistroTriagem;
  const precisaPessoa = result.verdict === "duvidosa" || (result.verdict === "recusa" && configuracao.triageApproval);
  const decisao = !precisaPessoa ? (result.verdict === "aceita" ? "aceitar" : "recusar") : review;
  if (decisao === null || decisao === "draft") {
    if (decisao === null) {
      await portas.alterar((estado) => {
        const tarefa = estado.tasks.find((t) => t.id === alvo.id);
        if (tarefa?.triage && tarefa.triage.review === null) tarefa.triage.review = "draft";
      });
      await portas.avisarDuvida(
        alvo.project,
        alvo.key,
        `A triagem da issue ${alvo.key} ${result.verdict === "recusa" ? "propõe recusar" : "ficou em dúvida"}` +
          ` (${result.reason}). Revise e decida na página da Tarefa.`,
      );
    }
    return "aguardar";
  }
  if (decisao === "aceitar") return (await haVaga(portas, alvo, configuracao.maxActive)) ? undefined : "adiar";
  await portas.fecharRecusada(
    alvo.project,
    alvo.key,
    refusalComment(result, referenciaDuplicata(result)),
    motivoDeFechamento(result),
  );
  return "recusada";
}

/**
 * Se cabe mais uma issue depois da triagem: `maxActive` conta só as Tarefas que já passaram dela. A triagem corre em
 * todas, e uma issue à espera da sua revisão não segura as outras. Cabendo, a vaga fica reservada no mesmo commit (a
 * etapa sai de `triagem`): uma pausa antes do passo seguinte não a libera para outra Tarefa.
 */
async function haVaga(portas: PortasTriagem, alvo: AlvoTriagem, maxActive: number): Promise<boolean> {
  return portas.alterar((estado) => {
    const busy = estado.tasks.filter(
      (t) =>
        t.project === alvo.project &&
        t.id !== alvo.id &&
        !TERMINAIS.has(t.status) &&
        t.stage != null &&
        t.stage !== "triagem",
    ).length;
    const own = estado.tasks.find((t) => t.id === alvo.id);
    if (own && busy < maxActive) own.stage = "assumir";
    return busy < maxActive;
  });
}
