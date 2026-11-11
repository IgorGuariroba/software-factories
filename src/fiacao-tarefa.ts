import type { Models } from "@earendil-works/pi-ai";
import type { createRegistry, Harness } from "@earendil-works/pi-durable";
import { nextProjectActivity } from "./business-hours.js";
import type { Channel } from "./channel.js";
import type { CodeHost } from "./code-host.js";
import type { ProjectConfig } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import type { TarefaSteps } from "./durable.js";
import { type FactoryState, InspectionBlocked, type Question } from "./durable.js";
import type { EffectWriter } from "./effect-writer.js";
import type { EventRecorder, NewEvent } from "./events.js";
import { escalonarTarefa } from "./fiacao-escalonamento.js";
import { criarEspecificacaoDaTarefa } from "./fiacao-especificacao.js";
import { criarPortasDaEtapa } from "./fiacao-etapas.js";
import { criarImplementacaoDaTarefa } from "./fiacao-implementacao.js";
import { criarPortasRetro } from "./fiacao-retro.js";
import { criarTriagemDaTarefa } from "./fiacao-triagem.js";
import type { ImplementationDeps } from "./implement-stage.js";
import { type createImplementationExtension, StageBlocked } from "./implement-stage.js";
import { GuardrailViolation } from "./marca-automacao.js";
import type { ResultadoInspecao } from "./packages/controle-tarefa/index.js";
import type { Perguntas } from "./packages/perguntas/index.js";
import { executarEtapa } from "./packages/tarefa/index.js";
import type { RetroSink } from "./retro-sink.js";
import type { createReviewExtension } from "./review-stage.js";
import type { TeamsNotifier } from "./teams-mcp.js";

export interface FiacaoTarefa {
  retryDelayMs: number;
  clock: { now(): number };
  eventRecorder: EventRecorder;
  implementationDeps: ImplementationDeps;
  implementationTools: ReturnType<typeof createImplementationExtension>;
  reviewTools: ReturnType<typeof createReviewExtension>;
  projectOf: (name: string) => ProjetoDaTarefa;
  opts: { models: Models; teams?: TeamsNotifier; retro?: { sink?: RetroSink; repo?: string } };
  /** Acessores preguiçosos: estas peças são criadas depois da Tarefa e só são usadas quando a etapa roda. */
  readonly harness: Harness;
  readonly events: Pick<EventRecorder, "list"> & { append(event: NewEvent): Promise<void> };
  readonly registry: ReturnType<typeof createRegistry>;
  readonly readState: () => Promise<FactoryState>;
  readonly forwardTechnical: (id: string, n: number) => Promise<void>;
  readonly markQuestion: (id: string, n: number, change: (q: Question) => void) => Promise<void>;
  readonly perguntas: Perguntas;
  readonly inspectCard: (input: { project: string; key: string }) => Promise<ResultadoInspecao>;
}

/** O que a Tarefa precisa de um projeto: a configuração, a Fonte, o escritor, o canal e o host de código. */
export interface ProjetoDaTarefa {
  config: ProjectConfig;
  source: DemandSource;
  writer: EffectWriter;
  channel: Channel;
  codeHost: CodeHost;
  knowledgeDir?: string;
}

/** Os passos da Tarefa durável: triagem, comentário, transição, retrô, revisão, entrega, SPEC e implementação. */
export function criarPassosDaTarefa(f: FiacaoTarefa): TarefaSteps {
  const { clock, eventRecorder, implementationDeps, implementationTools, reviewTools, projectOf, opts } = f;
  return {
    retryDelayMs: f.retryDelayMs,
    availableAt(input) {
      const config = projectOf(input.project).config;
      return nextProjectActivity(config, clock.now());
    },
    async run(input, step, runtime) {
      const project = projectOf(input.project);
      const { writer, source } = project;
      // A Tarefa desta execução, como está agora no estado.
      const lerTarefa = async () => (await f.readState()).tasks.find((t) => t.id === input.id);
      // O card desta Tarefa na Fonte. Sem ele, a etapa não tem o que fazer: lança.
      const cartao = async () => {
        const card = await source.getCard(input.key);
        if (!card) throw new Error(`card ${input.key} não existe mais`);
        return card;
      };
      const portasRetro = criarPortasRetro({
        lerEstado: () => f.readState(),
        harness: f.harness,
        runtime,
        taskId: input.id,
        cardKey: input.key,
        config: project.config,
        writer,
        eventRecorder,
        eventos: f.events,
        retro: opts.retro,
      });
      // Triagem da issue (ADR-0014): as portas e o modelo estão em fiacao-triagem.
      const { triage } = criarTriagemDaTarefa({
        input,
        runtime,
        harness: f.harness,
        eventos: f.events,
        projeto: project,
        projectOf,
        models: opts.models,
        cartao,
      });

      // SPEC e perguntas: as portas e a conversa ficam em fiacao-especificacao.
      const { grill, ask } = criarEspecificacaoDaTarefa({
        input,
        runtime,
        harness: f.harness,
        registry: f.registry,
        perguntas: f.perguntas,
        eventos: f.events,
        projeto: project,
        projectOf,
        clock,
        teams: opts.teams,
        cartao,
        lerTarefa,
      });
      // Implementação, revisão, entrega e repositório: as portas ficam em fiacao-implementacao.
      const { implement, etapaPortas, portasRepositorio } = criarImplementacaoDaTarefa({
        input,
        runtime,
        harness: f.harness,
        lerEstado: () => f.readState(),
        lerTarefa,
        cartao,
        eventos: f.events,
        projeto: project,
        implementationDeps,
        implementationTools,
        reviewTools,
        ask,
      });
      return executarEtapa(
        criarPortasDaEtapa({
          f,
          input,
          runtime,
          project,
          triage,
          grill,
          implement,
          etapaPortas,
          portasRepositorio,
          portasRetro,
        }),
        step,
      );

      /** Portas da execução de cada passo desta Tarefa. A ordem dos passos e o desfecho de cada um estão no pacote tarefa. */
    },
    escalate: (input, runtime) => escalonarTarefa({ f, projectOf, input, runtime }),
    inspect: (input) => f.inspectCard(input),
    vetoMs: (input) => projectOf(input.project).config.vetoMinutes * 60_000,
    async announceVeto(input, until) {
      const { vetoMinutes } = projectOf(input.project).config;
      await f.events.append({
        type: "notify",
        project: input.project,
        target: input.key,
        reason: "aguardando-veto",
        until: new Date(until).toISOString(),
        message:
          `A fábrica assumiu o card ${input.key}, que já estava em andamento, e continua o trabalho nele em ` +
          `${vetoMinutes} min (${new Date(until).toISOString()}) se você não vetar.`,
      });
    },
    classify: (err) =>
      err instanceof GuardrailViolation || err instanceof StageBlocked || err instanceof InspectionBlocked
        ? { kind: "blocked", reason: err.message }
        : { kind: "error", message: err instanceof Error ? err.message : String(err) },
    onError: (input, message) => f.events.append({ type: "error", project: input.project, target: input.key, message }),
  };
}
