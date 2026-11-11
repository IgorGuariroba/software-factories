import { describe, expect, it, vi } from "vitest";
import {
  type EstadoResposta,
  type EventoResposta,
  type PerguntaResposta,
  type PortasResposta,
  responderPergunta,
  type TarefaResposta,
} from "../src/packages/perguntas/index.js";

// Resposta do usuário a uma pergunta com portas falsas: fixa a validação da entrada, o registro da resposta, o
// encaminhamento de "não sei" nas perguntas técnicas, a escolha de repositório e o acordar do escalonador.

const teste = { command: ["npm", "test"], timeoutSeconds: 60, files: [] };
const repositorios = [
  { path: "/dados/sf", prefix: "SF", test: teste },
  { path: "/dados/outro", prefix: "OUT", test: teste },
];

function pergunta(extra: Partial<PerguntaResposta> = {}): PerguntaResposta {
  return { n: 1, origin: "grill", to: "po", text: "Qual o prazo?", answer: null, ...extra };
}

function portasFalsas(tarefa: TarefaResposta | undefined) {
  const estado: EstadoResposta = { tasks: tarefa ? [tarefa] : [] };
  const eventos: EventoResposta[] = [];
  const portas: PortasResposta = {
    alterar: async (fn) => fn(estado),
    repositoriosDoProjeto: () => repositorios,
    registrarResposta: vi.fn((_estado, id, n, resposta) => {
      const q = tarefa?.questions?.find((item) => item.n === n);
      if (!q || tarefa?.id !== id) return false;
      q.answer = resposta;
      return true;
    }),
    registrarEvento: async (evento) => {
      eventos.push(evento);
    },
    encaminharTecnica: vi.fn(async () => undefined),
    pedirReacao: vi.fn(() => undefined),
  };
  return { portas, eventos, estado };
}

const tarefaCom = (questions: PerguntaResposta[], extra: Partial<TarefaResposta> = {}): TarefaResposta => ({
  id: "sf/K-1",
  project: "sf",
  key: "K-1",
  status: "aguardando-humano",
  questions,
  ...extra,
});

describe("Resposta: entrada e estado", () => {
  it("número inválido, resposta vazia ou longa demais não são registradas", async () => {
    const { portas } = portasFalsas(tarefaCom([pergunta()]));
    expect(await responderPergunta(portas, "sf/K-1", 0, "sim")).toBe(false);
    expect(await responderPergunta(portas, "sf/K-1", 1.5, "sim")).toBe(false);
    expect(await responderPergunta(portas, "sf/K-1", 1, "   ")).toBe(false);
    expect(await responderPergunta(portas, "sf/K-1", 1, "x".repeat(20_001))).toBe(false);
    expect(portas.registrarResposta).not.toHaveBeenCalled();
  });

  it("pergunta inexistente, já respondida ou em envio não é registrada", async () => {
    const { portas } = portasFalsas(tarefaCom([pergunta({ answer: "antes" })]));
    expect(await responderPergunta(portas, "sf/K-1", 1, "outra")).toBe(false);
    expect(await responderPergunta(portas, "sf/K-1", 9, "x")).toBe(false);
    const { portas: emEnvio } = portasFalsas(tarefaCom([pergunta({ publication: "sending" })]));
    expect(await responderPergunta(emEnvio, "sf/K-1", 1, "x")).toBe(false);
  });

  it("Tarefa que não espera uma pessoa não aceita resposta", async () => {
    const { portas } = portasFalsas(tarefaCom([pergunta()], { status: "implementacao" }));
    expect(await responderPergunta(portas, "sf/K-1", 1, "sim")).toBe(false);
  });
});

describe("Resposta: registro", () => {
  it("resposta comum é registrada, marca sem encaminhamento, avisa e acorda o escalonador", async () => {
    const tarefa = tarefaCom([pergunta()]);
    const { portas, eventos } = portasFalsas(tarefa);
    expect(await responderPergunta(portas, "sf/K-1", 1, "  Até sexta.  ")).toBe(true);
    expect(tarefa.questions?.[0]).toMatchObject({ answer: "Até sexta.", needsForwarding: false });
    expect(eventos).toEqual([
      expect.objectContaining({ type: "question", status: "respondida", n: 1, text: "Qual o prazo?", target: "K-1" }),
    ]);
    expect(portas.pedirReacao).toHaveBeenCalledTimes(1);
  });

  it("técnica com 'não sei' vai para o encaminhamento e não é registrada como resposta", async () => {
    const tarefa = tarefaCom([pergunta({ origin: "tecnica", to: "tl" })]);
    const { portas, eventos } = portasFalsas(tarefa);
    expect(await responderPergunta(portas, "sf/K-1", 1, "não sei")).toBe(true);
    expect(portas.registrarResposta).not.toHaveBeenCalled();
    expect(tarefa.questions?.[0]).toMatchObject({ userResponse: "não sei", needsForwarding: true, answer: null });
    expect(eventos).toEqual([expect.objectContaining({ status: "encaminhar", text: "não sei" })]);
    expect(portas.encaminharTecnica).toHaveBeenCalledWith("sf/K-1", 1);
  });
});

describe("Resposta: escolha de repositório", () => {
  it("caminho ou prefixo exato da lista define o repositório da Tarefa", async () => {
    const tarefa = tarefaCom([pergunta({ origin: "tecnica", purpose: "repositorio" })]);
    const { portas } = portasFalsas(tarefa);
    expect(await responderPergunta(portas, "sf/K-1", 1, "OUT")).toBe(true);
    expect(tarefa.repositoryPath).toBe("/dados/outro");
  });

  it("texto que não identifica um repositório único não é resolução", async () => {
    const tarefa = tarefaCom([pergunta({ origin: "tecnica", purpose: "repositorio" })]);
    const { portas } = portasFalsas(tarefa);
    expect(await responderPergunta(portas, "sf/K-1", 1, "o de sempre")).toBe(false);
    expect(tarefa.repositoryPath).toBeUndefined();
    expect(portas.registrarResposta).not.toHaveBeenCalled();
  });
});
