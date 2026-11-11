import {
  copyOutOfCommit,
  type QueuedTask,
  RETRO_STEP,
  type RetroStage,
  StateDoc,
  type StepRuntime,
  type TarefaInput,
} from "./durable.js";
import { tarefaDoEstado } from "./estado-fabrica.js";
import type { FiacaoTarefa, ProjetoDaTarefa } from "./fiacao-tarefa.js";
import { concluirRetro, type PortasRetro } from "./packages/retro-etapa/index.js";
import { aprovacaoVigente } from "./packages/spec-etapa/index.js";
import {
  ciclarRevisao,
  escolherRepositorio,
  esperaVetoAoAssumir,
  executarEntrega,
  jaAnunciouAssumido,
  type PortasEtapa,
  type PortasExecucao,
  type PortasRepositorio,
} from "./packages/tarefa/index.js";
import { renderTickets, type SpecDelivery } from "./spec-stage.js";

/** O que as portas de cada passo precisam: o wiring da fábrica, a Tarefa, o projeto e as partes já montadas. */
export interface ContextoEtapa {
  f: FiacaoTarefa;
  input: TarefaInput;
  runtime: StepRuntime;
  project: ProjetoDaTarefa;
  triage: () => Promise<"aguardar" | "recusada" | "adiar" | undefined>;
  grill: () => Promise<SpecDelivery | "aguardar">;
  implement: (repositoryPath?: string) => Promise<void>;
  etapaPortas: () => PortasEtapa;
  portasRepositorio: () => PortasRepositorio;
  portasRetro: PortasRetro;
}

export function criarPortasDaEtapa(ctx: ContextoEtapa): PortasExecucao {
  const { f, input, runtime, project, triage, grill, implement, etapaPortas, portasRepositorio, portasRetro } = ctx;
  const { writer } = project;
  return {
    triar: () => triage(),
    anunciarAssumido: async () => {
      if (project.config.announceAssume) await writer.commentOnce(input.key, "Assumindo este card.");
    },
    jaAnunciouAssumido: () => jaAnunciouAssumido(f.events.list(), input.project, input.key),
    registrarAssumido: async () => {
      let task: QueuedTask | undefined;
      await runtime.commit(async (tx) => {
        const stored = tarefaDoEstado(await tx.doc(StateDoc), input.id);
        task = stored && copyOutOfCommit(stored);
      });
      await f.events.append({
        type: "assumed",
        project: input.project,
        target: input.key,
        title: task?.title ?? "",
        waitsVeto: esperaVetoAoAssumir(task?.startedIn),
      });
    },
    transicionar: async () => {
      await writer.transition(input.key, "in_progress", { from: "todo" });
    },
    etapaDeRetro: (passo) =>
      (Object.entries(RETRO_STEP) as [RetroStage, string][]).find(([, valor]) => valor === passo)?.[0],
    retro: (etapa) =>
      concluirRetro(
        portasRetro,
        { id: input.id, projeto: input.project, chave: input.key },
        etapa,
        project.config.retroApproval,
      ),
    revisar: () => ciclarRevisao(etapaPortas(), []),
    entregar: () => executarEntrega(etapaPortas()),
    implementar: async () => {
      const escolha = await escolherRepositorio(portasRepositorio());
      if (escolha === "aguardar") return "aguardar" as const;
      await implement(escolha.caminho);
      return undefined;
    },
    // Uma tentativa anterior já obteve a entrega: republica a mesma, sem chamar o modelo de novo.
    entregaDaSpec: async () => {
      let delivery: SpecDelivery | undefined;
      await runtime.commit(async (tx) => {
        const stored = tarefaDoEstado(await tx.doc(StateDoc), input.id)?.delivery;
        delivery = stored ? copyOutOfCommit(stored) : undefined;
      });
      return delivery;
    },
    especificar: () => grill(),
    exigeAprovacaoSpec: () => project.config.specApproval,
    aprovacaoSpecVigente: async () => {
      let approved = false;
      await runtime.commit(async (tx) => {
        const task = tarefaDoEstado(await tx.doc(StateDoc), input.id);
        if (!task) return;
        approved = aprovacaoVigente(task, project.config.dryRun);
        if (!approved) task.specReview = "draft";
      });
      return approved;
    },
    publicarSpec: async (entrega) => {
      await writer.upsertComment(input.key, "SPEC", entrega.spec);
      await writer.upsertComment(input.key, "Tickets", renderTickets(entrega.tickets as SpecDelivery["tickets"]));
    },
  };
}
