import type { Harness } from "@earendil-works/pi-durable";
import { resolverAgenteDaEtapa } from "./agente-etapa-config.js";
import type { ProjectConfig } from "./config.js";
import type { FactoryState, QueuedTask, RetroStage, StepRuntime } from "./durable.js";
import { StateDoc } from "./durable.js";
import type { EffectWriter } from "./effect-writer.js";
import { tarefaDoEstado } from "./estado-fabrica.js";
import type { EventRecorder } from "./events.js";
import {
  entradaDaRetro,
  type PortasRetro,
  type TarefaRetro,
  type TarefaRetrospectiva,
} from "./packages/retro-etapa/index.js";
import type { RetroSink } from "./retro-sink.js";
import { runRetro } from "./retro-stage.js";
import { taskEvents } from "./task-view.js";

// Retrô de cada etapa, vista pela Tarefa: a regra (quando roda, quando segura a Tarefa) está no pacote retro-etapa; aqui
// ficam a leitura da Tarefa, a execução da retrô e a gravação da pausa.

export interface ContextoRetro {
  lerEstado(): Promise<FactoryState>;
  harness: Harness;
  runtime: StepRuntime;
  taskId: string;
  cardKey: string;
  config: ProjectConfig;
  writer: EffectWriter;
  /** Gravador de eventos da execução da retrô. */
  eventRecorder: EventRecorder;
  /** Eventos da fábrica: lidos pela entrada da retrô e usados pelos avisos. */
  eventos: EventRecorder;
  retro?: { sink?: RetroSink; repo?: string };
}

/** Portas da retrô de uma Tarefa, para o pacote retro-etapa. */
export function criarPortasRetro(ctx: ContextoRetro): PortasRetro {
  const { lerEstado, harness, runtime, cardKey, config, writer, eventRecorder, eventos, retro } = ctx;
  return {
    tarefa: async (id) => (await lerEstado()).tasks.find((t) => t.id === id) as unknown as TarefaRetro | undefined,
    executar: async (id, etapa, tarefa) => {
      await runRetro({
        harness,
        runtime,
        taskId: id,
        cardKey,
        stage: etapa as RetroStage,
        config: config,
        writer,
        events: eventRecorder,
        agente: resolverAgenteDaEtapa(config, "retro"),
        input: async () => {
          const current = (await lerEstado()).tasks.find((t) => t.id === id) ?? (tarefa as unknown as QueuedTask);
          return entradaDaRetro(
            etapa as RetroStage,
            current as unknown as TarefaRetrospectiva,
            taskEvents(current, eventos.list()),
          );
        },
        sink: retro?.sink,
        repo: retro?.repo,
      });
    },
    pausarParaRevisao: async (id, etapa) => {
      let pausou = false;
      await runtime.commit(async (tx) => {
        const alvo = tarefaDoEstado(await tx.doc(StateDoc), id);
        if (!alvo || alvo.retroHeld?.includes(etapa as RetroStage)) return;
        alvo.retroHeld = [...(alvo.retroHeld ?? []), etapa as RetroStage];
        alvo.pauseRequested = true;
        pausou = true;
      });
      return pausou;
    },
    avisarPronta: async (projeto, chave, etapa) => {
      await eventos.append({
        type: "notify",
        project: projeto,
        target: chave,
        reason: "retro-pronta",
        message:
          `A retrô da etapa ${etapa} do card ${chave} está pronta. ` +
          "A Tarefa está pausada antes da próxima etapa: revise e retome para continuar.",
      });
    },
  };
}
