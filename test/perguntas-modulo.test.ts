import { describe, expect, it, vi } from "vitest";
import {
  criarPerguntas,
  type EstadoPerguntas,
  type PerguntaFila,
  type PortasPerguntas,
} from "../src/packages/perguntas/index.js";

// Módulo de Perguntas com portas falsas: fixa a verificação de respostas pelo Canal, a máquina de estados do aviso ao
// Teams (que nunca repete um envio incerto) e os eventos de erro. Sem fábrica, sem Teams, sem Jira.

const pergunta = (extra: Partial<PerguntaFila> = {}): PerguntaFila => ({
  n: 1,
  origin: "grill",
  to: "po",
  text: "Qual o prazo?",
  ref: { card: "p/K-1", to: "po", before: [] },
  answer: null,
  publication: "sent",
  teamsNotice: { userId: "u1", link: "https://jira/browse/K-1", status: "pending" },
  ...extra,
});

function estadoCom(perguntas: PerguntaFila[], tarefa: Partial<EstadoPerguntas["tasks"][number]> = {}): EstadoPerguntas {
  return {
    daemonPaused: false,
    tasks: [
      {
        id: "p/K-1",
        project: "p",
        key: "K-1",
        title: "Título do card",
        status: "aguardando-humano",
        pauseRequested: false,
        questions: perguntas,
        ...tarefa,
      },
    ],
  };
}

function portasFalsas(estado: EstadoPerguntas, sobrescritas: Partial<PortasPerguntas> = {}) {
  const enviados: { userId: string; texto: string }[] = [];
  const eventos: unknown[] = [];
  const respostasRegistradas: { id: string; n: number; resposta: string }[] = [];
  const canal = {
    ask: vi.fn(),
    remind: vi.fn(),
    answer: vi.fn(async () => undefined as string | undefined),
  };
  const portas: PortasPerguntas = {
    estado: async () => estado,
    alterar: async (fn) => fn(estado),
    agora: () => 1_000,
    projeto: (nome) =>
      nome === "p"
        ? {
            canal,
            dryRun: false,
            chavesDaFonte: undefined,
            proximaAtividade: (agora: number) => agora,
            pessoaPO: (id: string) => (id === "po" ? { nome: "Ana Lima", identidadeTeams: "u1" } : undefined),
          }
        : undefined,
    projetoPausado: () => false,
    perguntaPendente: (tarefa) => (tarefa.questions?.at(-1)?.answer === null ? tarefa.questions.at(-1) : undefined),
    registrarResposta: (_state, id, n, resposta) => {
      respostasRegistradas.push({ id, n, resposta });
      return true;
    },
    avisoTeams: async (userId, texto) => {
      enviados.push({ userId, texto });
    },
    registrarEvento: async (evento) => {
      eventos.push(evento);
    },
    ...sobrescritas,
  };
  return { portas, canal, enviados, eventos, respostasRegistradas };
}

describe("aviso ao Teams", () => {
  it("envia uma vez, com o nome da PO e o link, e marca o aviso como enviado", async () => {
    const estado = estadoCom([pergunta()]);
    const { portas, enviados } = portasFalsas(estado);

    await criarPerguntas(portas).verificar();

    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ userId: "u1" });
    expect(enviados[0]?.texto).toContain("Olá, Ana!");
    expect(enviados[0]?.texto).toContain("K-1 (Título do card)");
    expect(estado.tasks[0]?.questions?.[0]?.teamsNotice?.status).toBe("sent");
  });

  it("não envia em ensaio (dryRun), e o aviso fica pendente", async () => {
    const estado = estadoCom([pergunta()]);
    const { portas, enviados } = portasFalsas(estado, {
      projeto: () => ({
        canal: { ask: vi.fn(), remind: vi.fn(), answer: vi.fn(async () => undefined) },
        dryRun: true,
        chavesDaFonte: undefined,
        proximaAtividade: (agora: number) => agora,
        pessoaPO: () => ({ nome: "Ana", identidadeTeams: "u1" }),
      }),
    });

    await criarPerguntas(portas).verificar();

    expect(enviados).toEqual([]);
    expect(estado.tasks[0]?.questions?.[0]?.teamsNotice?.status).toBe("pending");
  });

  it("falha no envio: o aviso fica incerto, registra o erro e nunca é reenviado sozinho", async () => {
    const estado = estadoCom([pergunta()]);
    const avisoTeams = vi.fn(async () => {
      throw new Error("timeout");
    });
    const { portas, eventos } = portasFalsas(estado, { avisoTeams });

    await criarPerguntas(portas).verificar();
    await criarPerguntas(portas).verificar();

    expect(avisoTeams).toHaveBeenCalledTimes(1);
    expect(estado.tasks[0]?.questions?.[0]?.teamsNotice?.status).toBe("uncertain");
    expect(eventos).toEqual([
      expect.objectContaining({ type: "error", message: expect.stringContaining("aviso Teams não confirmado") }),
    ]);
  });

  it("tarefa pausada ou daemon pausado não recebe aviso", async () => {
    const pausada = estadoCom([pergunta()], { pauseRequested: true });
    const a = portasFalsas(pausada);
    await criarPerguntas(a.portas).verificar();
    expect(a.enviados).toEqual([]);

    const daemon = estadoCom([pergunta()]);
    daemon.daemonPaused = true;
    const b = portasFalsas(daemon);
    await criarPerguntas(b.portas).verificar();
    expect(b.enviados).toEqual([]);
  });

  it("só a PO cuja identidade no Teams bate com o aviso recebe; outra pessoa não", async () => {
    const estado = estadoCom([pergunta({ to: "tl", teamsNotice: { userId: "u1", link: "L", status: "pending" } })]);
    const { portas, enviados } = portasFalsas(estado);

    await criarPerguntas(portas).verificar();

    expect(enviados).toEqual([]);
    expect(estado.tasks[0]?.questions?.[0]?.teamsNotice?.status).toBe("pending");
  });
});

describe("aviso ao Teams logo após publicar a pergunta", () => {
  it("avisarTeams envia o aviso da pergunta recém-publicada, sem esperar a próxima verificação", async () => {
    const estado = estadoCom([pergunta()]);
    const { portas, enviados } = portasFalsas(estado);

    await criarPerguntas(portas).avisarTeams("p/K-1", "p", "K-1", 1);

    expect(enviados).toHaveLength(1);
    expect(estado.tasks[0]?.questions?.[0]?.teamsNotice?.status).toBe("sent");
  });
});

describe("conferência pontual, usada pelo escalonamento da Tarefa", () => {
  it("conferir devolve true quando a resposta chegou, e false quando ainda não há resposta", async () => {
    const estado = estadoCom([pergunta({ teamsNotice: undefined })]);
    const { portas, canal } = portasFalsas(estado);
    canal.answer.mockResolvedValueOnce("sim");
    expect(await criarPerguntas(portas).conferir("p/K-1", 1)).toBe(true);

    canal.answer.mockResolvedValueOnce(undefined);
    expect(await criarPerguntas(portas).conferir("p/K-1", 1)).toBe(false);
  });

  it("conferir não olha pergunta técnica: ela é respondida pela fábrica, não pelo Canal", async () => {
    const estado = estadoCom([pergunta({ origin: "tecnica", teamsNotice: undefined })]);
    const { portas, canal } = portasFalsas(estado);

    expect(await criarPerguntas(portas).conferir("p/K-1", 1)).toBe(false);
    expect(canal.answer).not.toHaveBeenCalled();
  });
});

describe("verificação de respostas", () => {
  it("resposta que chegou pelo Canal é registrada e vira evento 'respondida'", async () => {
    const estado = estadoCom([pergunta({ teamsNotice: undefined })]);
    const { portas, canal, respostasRegistradas, eventos } = portasFalsas(estado);
    canal.answer.mockResolvedValueOnce("sim, 5 dias");

    await criarPerguntas(portas).verificar();

    expect(respostasRegistradas).toEqual([{ id: "p/K-1", n: 1, resposta: "sim, 5 dias" }]);
    expect(eventos).toEqual([expect.objectContaining({ type: "question", status: "respondida", n: 1 })]);
  });

  it("pergunta técnica não é conferida no Canal", async () => {
    const estado = estadoCom([pergunta({ origin: "tecnica", teamsNotice: undefined })]);
    const { portas, canal } = portasFalsas(estado);

    await criarPerguntas(portas).verificar();

    expect(canal.answer).not.toHaveBeenCalled();
  });

  it("fora do expediente do projeto, nada é conferido", async () => {
    const estado = estadoCom([pergunta({ teamsNotice: undefined })]);
    const canal = { ask: vi.fn(), remind: vi.fn(), answer: vi.fn(async () => undefined) };
    const { portas } = portasFalsas(estado, {
      projeto: () => ({
        canal,
        dryRun: false,
        chavesDaFonte: undefined,
        proximaAtividade: () => 9_999,
        pessoaPO: () => undefined,
      }),
    });

    await criarPerguntas(portas).verificar();

    expect(canal.answer).not.toHaveBeenCalled();
  });

  it("erro numa pergunta vira evento e não impede a verificação das demais", async () => {
    const estado = estadoCom([pergunta({ teamsNotice: undefined })]);
    estado.tasks.push({
      id: "p/K-2",
      project: "p",
      key: "K-2",
      title: "Outro",
      status: "aguardando-humano",
      pauseRequested: false,
      questions: [pergunta({ teamsNotice: undefined, ref: { card: "p/K-2", to: "po", before: [] } })],
    });
    const { portas, canal, eventos, respostasRegistradas } = portasFalsas(estado);
    canal.answer.mockRejectedValueOnce(new Error("Canal fora do ar")).mockResolvedValueOnce("resposta");

    await criarPerguntas(portas).verificar();

    expect(eventos).toEqual([
      expect.objectContaining({ type: "error", target: "K-1", message: expect.stringContaining("Canal fora do ar") }),
      expect.objectContaining({ type: "question", status: "respondida", target: "K-2" }),
    ]);
    expect(respostasRegistradas.map((r) => r.id)).toEqual(["p/K-2"]);
  });
});
