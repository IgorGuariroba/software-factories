import { nextProjectActivity } from "./business-hours.js";
import { copyOutOfCommit, type Question, StateDoc, type StepRuntime, type TarefaInput } from "./durable.js";
import { tarefaDoEstado } from "./estado-fabrica.js";
import type { NewEvent } from "./events.js";
import type { FiacaoTarefa, ProjetoDaTarefa } from "./fiacao-tarefa.js";
import { escalonarPergunta, type PerguntaEscalonavel, pendingQuestion } from "./packages/perguntas/index.js";
import { proximaPessoaDoPapel } from "./packages/profiles/index.js";

/** O que o escalonamento da pergunta pendente precisa: a Fonte da fábrica e as funções de cada projeto. */
export function escalonarTarefa(ctx: {
  f: FiacaoTarefa;
  projectOf: (name: string) => ProjetoDaTarefa;
  input: TarefaInput;
  runtime: StepRuntime;
}): Promise<number | null> {
  const { f, projectOf, input, runtime } = ctx;
  const project = projectOf(input.project);
  // Escalonamento da pergunta pendente, inclusive a espera pelo expediente: no pacote f.perguntas. A fábrica fornece o
  // estado, o Canal e os eventos.
  return escalonarPergunta(
    {
      agora: () => runtime.now(),
      proximaAtividade: (projeto, agora) => {
        const config = projectOf(projeto).config;
        return config.activity === "business-hours" ? nextProjectActivity(config, agora) : agora;
      },
      pendente: async (tarefaId) => {
        let question: Question | undefined;
        await runtime.commit(async (tx) => {
          const task = tarefaDoEstado(await tx.doc(StateDoc), tarefaId);
          const pending = task && pendingQuestion(task);
          question = pending ? copyOutOfCommit(pending) : undefined;
        });
        return question as unknown as PerguntaEscalonavel | undefined;
      },
      alterarPergunta: (tarefaId, n, mudar) => f.markQuestion(tarefaId, n, mudar as (q: Question) => void),
      conferir: (tarefaId, n) => f.perguntas.conferir(tarefaId, n),
      encaminharTecnica: (tarefaId, n) => f.forwardTechnical(tarefaId, n),
      lembrar: (ref, texto) => project.channel.remind(ref, texto),
      perguntarNoCanal: (entrada) => project.channel.ask(entrada),
      proximaPO: (projeto, idAtual) => proximaPessoaDoPapel(projectOf(projeto).config, "po", idAtual),
      configuracao: (projeto) => {
        const { config } = projectOf(projeto);
        return { questionApproval: config.questionApproval, calendario: config.calendar };
      },
      registrarEvento: async (evento) => {
        await f.events.append(evento as NewEvent);
      },
    },
    { id: input.id, projeto: input.project, chave: input.key },
  );
}
