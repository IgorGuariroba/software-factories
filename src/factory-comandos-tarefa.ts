import type { Context } from "@earendil-works/chord/context";
import type { Harness } from "@earendil-works/pi-durable";
import type { FactoryState, QueuedTask } from "./durable.js";
import type { FactoryEvent } from "./events.js";
import type { Acoes } from "./packages/acoes/index.js";
import type { FactoryCommands } from "./packages/api-local/index.js";
import type { Decisoes } from "./packages/decisoes/index.js";
import { taskDetail } from "./task-view.js";
import { conversasDaTarefa, traceDaTarefa } from "./trace-tarefa.js";

// Comandos sobre uma Tarefa (consulta, reparo, mensagem a uma etapa e as decisões humanas): montados aqui, a partir do
// estado e das decisões que a fábrica já tem. A raiz só junta este grupo aos demais comandos.

/** Peças da fábrica que os comandos de Tarefa usam. */
export interface DepsComandosTarefa {
  lerEstado(): Promise<FactoryState>;
  harness: Harness;
  context: Context;
  events: { list(): FactoryEvent[] };
  /** Registra a resposta de uma pergunta (mesma regra da Web e do Telegram). */
  responder(id: string, n: number, texto: string): Promise<boolean>;
  decisoes: Decisoes;
  acoes: Acoes;
}

type ComandosDeTarefa = Pick<
  FactoryCommands,
  | "tarefa"
  | "trace"
  | "esquecerMemoria"
  | "previaReparo"
  | "aplicarReparo"
  | "mensagemEtapa"
  | "previaTriagem"
  | "decidirTriagem"
  | "previaSpec"
  | "aprovarSpec"
  | "previaLembrete"
  | "aprovarLembrete"
  | "responderPergunta"
  | "previaPergunta"
  | "aprovarPergunta"
  | "previaRetro"
  | "aprovarRetro"
>;

/** A Tarefa de `id` no estado atual, ou a resposta 404 que todo comando de Tarefa devolve quando ela não existe. */
async function tarefaOu404(
  lerEstado: () => Promise<FactoryState>,
  id: string,
): Promise<{ tarefa: QueuedTask } | { erro: { status: number; body: unknown } }> {
  const tarefa = (await lerEstado()).tasks.find((t) => t.id === id);
  return tarefa ? { tarefa } : { erro: { status: 404, body: { error: `Tarefa ${id} não existe` } } };
}

/** Comandos sobre uma Tarefa, prontos para entrar no objeto de comandos da API. */
export function comandosDeTarefa(deps: DepsComandosTarefa): ComandosDeTarefa {
  const { lerEstado, harness, context, events, responder, decisoes, acoes } = deps;
  return {
    tarefa: async (id) => {
      const lida = await tarefaOu404(lerEstado, id);
      if ("erro" in lida) return lida.erro;
      return { status: 200, body: taskDetail(lida.tarefa, events.list()) };
    },
    trace: async (id) => {
      const lida = await tarefaOu404(lerEstado, id);
      if ("erro" in lida) return lida.erro;
      return { status: 200, body: await traceDaTarefa(harness, lida.tarefa, context) };
    },
    esquecerMemoria: (id, etapa) => acoes.esquecerMemoria(id, etapa),
    previaReparo: (id) => acoes.previaReparo(id),
    aplicarReparo: (id, corpo) => acoes.aplicarReparo(id, corpo),
    mensagemEtapa: async (id, etapa, texto) => {
      const lida = await tarefaOu404(lerEstado, id);
      if ("erro" in lida) return lida.erro;
      const conversa = [...conversasDaTarefa(lida.tarefa)].find(([, nome]) => nome === etapa)?.[0];
      if (!conversa) return { status: 404, body: { error: `a etapa ${etapa} ainda não tem conversa nesta tarefa` } };
      const handle = await harness.conversation(conversa, context);
      if (!handle) return { status: 404, body: { error: `a conversa da etapa ${etapa} não existe mais` } };
      // Com a etapa em execução, a mensagem vira steer no próximo ponto de decisão; parada, inicia um turno novo.
      await handle.submit(
        {
          type: "input",
          content: texto,
          requestId: `usuario-${globalThis.crypto.randomUUID()}`,
          whenBusy: "steer",
        },
        context,
      );
      return { status: 200, body: { etapa, enviada: true } };
    },
    previaTriagem: (id) => decisoes.triagem(id, false, undefined),
    decidirTriagem: (id, corpo) => decisoes.triagem(id, true, corpo),
    previaSpec: (id) => decisoes.spec(id, false, undefined),
    aprovarSpec: (id, corpo) => decisoes.spec(id, true, corpo),
    previaLembrete: (id, n) => decisoes.lembrete(id, n, false, undefined),
    aprovarLembrete: (id, n, corpo) => decisoes.lembrete(id, n, true, corpo),
    responderPergunta: async (id, n, texto) => {
      const task = (await lerEstado()).tasks.find((t) => t.id === id);
      if (!task?.questions?.some((q) => q.n === n)) return { status: 404, body: { error: "pergunta não encontrada" } };
      // Web e Telegram usam a mesma classificação e o mesmo despertar atômico.
      const ok = await responder(id, n, texto);
      return ok
        ? { status: 200, body: { ok: true } }
        : { status: 409, body: { error: "pergunta não está disponível para resposta" } };
    },
    previaPergunta: (id, n) => decisoes.pergunta(id, n, false, undefined),
    aprovarPergunta: (id, n, corpo) => decisoes.pergunta(id, n, true, corpo),
    previaRetro: (id, etapa, n) => decisoes.proposta(id, etapa, n, false, undefined),
    aprovarRetro: (id, etapa, n, corpo) => decisoes.proposta(id, etapa, n, true, corpo),
  };
}
