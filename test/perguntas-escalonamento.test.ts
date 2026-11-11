import { describe, expect, it, vi } from "vitest";
import { BusinessCalendar } from "../src/config.js";
import {
  type EventoEscalonamento,
  escalonarPergunta,
  type PerguntaEscalonavel,
  type PortasEscalonamento,
} from "../src/packages/perguntas/index.js";

// Escalonamento de perguntas sem resposta com portas falsas: fixa o encaminhamento técnico, o rascunho com revisão, o
// lembrete, o escalonamento à pessoa seguinte do PO e o aviso de um dia útil, com o instante de acordar devolvido.

const CALENDARIO = BusinessCalendar.parse({ timezone: "UTC" });
const SEG_10H = Date.UTC(2026, 0, 5, 10, 0, 0); // segunda-feira, 10h
const HORA = 60 * 60_000;

function pergunta(extra: Partial<PerguntaEscalonavel> = {}): PerguntaEscalonavel {
  return {
    n: 1,
    origin: "grill",
    to: "po-1",
    text: "Qual o prazo?",
    ref: { card: "K-1", to: "po-1", before: [] },
    remindAt: SEG_10H + HORA,
    notifyAt: SEG_10H + 8 * HORA,
    reminded: false,
    notified: false,
    answer: null,
    ...extra,
  };
}

function portasFalsas(
  q: PerguntaEscalonavel | undefined,
  config: { questionApproval?: boolean; agora?: number; proximaAtividade?: number } = {},
) {
  const eventos: EventoEscalonamento[] = [];
  const alteracoes: PerguntaEscalonavel[] = [];
  const estado = q ? { ...q } : undefined;
  const portas: PortasEscalonamento = {
    agora: () => config.agora ?? SEG_10H,
    proximaAtividade: (_projeto, agora) => config.proximaAtividade ?? agora,
    pendente: async () => estado,
    alterarPergunta: async (_id, _n, mudar) => {
      if (estado) mudar(estado);
      if (estado) alteracoes.push({ ...estado });
    },
    conferir: async () => false,
    encaminharTecnica: vi.fn(async () => undefined),
    lembrar: vi.fn(async () => undefined),
    perguntarNoCanal: vi.fn(async () => ({ card: "K-1", to: "po-2", before: [] })),
    proximaPO: (_projeto, atual) => (atual === "po-1" ? { id: "po-2", name: "Bia" } : undefined),
    configuracao: () => ({ questionApproval: config.questionApproval ?? false, calendario: CALENDARIO }),
    registrarEvento: async (evento) => {
      eventos.push(evento);
    },
  };
  return { portas, eventos, alteracoes, estado };
}

const alvo = { id: "p/K-1", projeto: "p", chave: "K-1" };

describe("Escalonamento: casos sem lembrete", () => {
  it("sem pergunta pendente, não há o que acordar", async () => {
    const { portas } = portasFalsas(undefined);
    expect(await escalonarPergunta(portas, alvo)).toBeNull();
  });

  it("pergunta em rascunho ou em envio espera um minuto e não é escalonada", async () => {
    const { portas, eventos } = portasFalsas(pergunta({ publication: "draft" }));
    expect(await escalonarPergunta(portas, alvo)).toBe(SEG_10H + 60_000);
    expect(eventos).toEqual([]);
  });

  it("resposta que chegou pelo Canal encerra o escalonamento", async () => {
    const { portas } = portasFalsas(pergunta());
    portas.conferir = async () => true;
    expect(await escalonarPergunta(portas, alvo)).toBeNull();
  });
});

describe("Escalonamento: técnica", () => {
  it("sem encaminhamento ainda, encaminha e acorda no prazo do lembrete técnico", async () => {
    const q = pergunta({ origin: "tecnica", to: "tl-1" });
    const { portas } = portasFalsas(q);
    expect(await escalonarPergunta(portas, alvo)).toBe(q.remindAt);
    expect(portas.encaminharTecnica).toHaveBeenCalledWith("p/K-1", 1);
  });

  it("já encaminhada, não acorda mais", async () => {
    const q = pergunta({ origin: "tecnica", to: "tl-1", forwarding: { status: "sending" } });
    const { portas } = portasFalsas(q);
    expect(await escalonarPergunta(portas, alvo)).toBeNull();
  });
});

describe("Escalonamento: lembrete ao PO", () => {
  it("sem revisão, lembra pelo Canal, marca como lembrada e registra o evento", async () => {
    const { portas, eventos, estado } = portasFalsas(pergunta({ remindAt: SEG_10H - 1 }));
    const proximo = await escalonarPergunta(portas, alvo);
    expect(portas.lembrar).toHaveBeenCalledWith(
      expect.objectContaining({ card: "K-1" }),
      expect.stringContaining("Lembrete da pergunta 1"),
    );
    expect(estado?.reminded).toBe(true);
    expect(eventos).toEqual([expect.objectContaining({ type: "question", status: "lembrete" })]);
    // Ainda falta o aviso: acorda no instante dele.
    expect(proximo).toBe(SEG_10H + 8 * HORA);
  });

  it("com revisão, o lembrete vira rascunho: não sai sozinho, avisa o usuário", async () => {
    const { portas, eventos, estado } = portasFalsas(pergunta({ remindAt: SEG_10H - 1 }), { questionApproval: true });
    await escalonarPergunta(portas, alvo);
    expect(portas.lembrar).not.toHaveBeenCalled();
    expect(estado?.reminder).toBe("draft");
    expect(eventos).toEqual([expect.objectContaining({ type: "notify", reason: "pergunta-sem-resposta" })]);
  });
});

describe("Escalonamento: pessoa seguinte e aviso", () => {
  it("sem resposta no prazo, escalona à pessoa seguinte e acorda em 4 horas úteis", async () => {
    const q = pergunta({ notifyAt: SEG_10H - 1, remindAt: SEG_10H - 1, reminded: true });
    const { portas, eventos, estado } = portasFalsas(q);
    const proximo = await escalonarPergunta(portas, alvo);
    expect(portas.perguntarNoCanal).toHaveBeenCalledWith(
      expect.objectContaining({ to: "po-2", text: "Pergunta 1 (encaminhada a Bia): Qual o prazo?" }),
    );
    expect(estado).toMatchObject({ to: "po-2", reminded: false, notified: false });
    expect(eventos).toEqual([expect.objectContaining({ type: "question", status: "escalonada", to: "po-2" })]);
    expect(proximo).toBe(SEG_10H + 4 * HORA);
  });

  it("com revisão, o escalonamento vira rascunho e não pergunta pelo Canal", async () => {
    const q = pergunta({ notifyAt: SEG_10H - 1, remindAt: SEG_10H - 1, reminded: true });
    const { portas, eventos, estado } = portasFalsas(q, { questionApproval: true });
    await escalonarPergunta(portas, alvo);
    expect(portas.perguntarNoCanal).not.toHaveBeenCalled();
    expect(estado).toMatchObject({ to: "po-2", publication: "draft" });
    expect(eventos).toEqual([
      expect.objectContaining({ type: "notify", message: expect.stringContaining("aguarda a sua revisão") }),
    ]);
  });

  it("sem pessoa seguinte, avisa o usuário uma vez que está há um dia útil sem resposta", async () => {
    const q = pergunta({ to: "po-x", notifyAt: SEG_10H - 1, remindAt: SEG_10H - 1, reminded: true });
    const { portas, eventos, estado } = portasFalsas(q);
    expect(await escalonarPergunta(portas, alvo)).toBeNull();
    expect(estado?.notified).toBe(true);
    expect(eventos).toEqual([
      expect.objectContaining({ type: "notify", message: expect.stringContaining("1 dia útil") }),
    ]);
  });
});

describe("Escalonamento: expediente", () => {
  it("fora do expediente, espera o próximo instante de atividade sem consultar a pergunta", async () => {
    const proxima = SEG_10H + 3 * HORA;
    const { portas } = portasFalsas(pergunta({ remindAt: SEG_10H - 1 }), { proximaAtividade: proxima });
    const pendente = vi.spyOn(portas, "pendente");
    expect(await escalonarPergunta(portas, alvo)).toBe(proxima);
    expect(pendente).not.toHaveBeenCalled();
    expect(portas.lembrar).not.toHaveBeenCalled();
  });
});
