import { describe, expect, it, vi } from "vitest";
import type { Card } from "../src/demand-source.js";
import {
  conduzirSpec,
  type PerguntaSpec,
  type PortasSpec,
  type ResultadoSpec,
  SpecBloqueada,
} from "../src/packages/spec-etapa/index.js";
import { answerFollowUp, SHALLOW_CARD_QUESTION } from "../src/spec-stage.js";

// SPEC com portas falsas: fixa a espera por resposta pendente, a pergunta do card raso, o follow-up conforme a origem da
// última pergunta, a pergunta devolvida pelo modelo, a entrega gravada e o bloqueio do ensaio de revisão.

const cardCompleto = {
  key: "SF-1",
  title: "Exportar relatório",
  description:
    "Quero exportar o relatório mensal em CSV com todas as colunas, filtrando por período e projeto, ".repeat(3),
  status: "todo",
  assignee: "ana",
} as unknown as Card;

const entrega = { spec: "SPEC pronta", tickets: [{ titulo: "t1", aceite: "a1" }] };

function portasFalsas(
  perguntas: PerguntaSpec[],
  resultado: ResultadoSpec,
  config: { questionApproval?: boolean; specApproval?: boolean } = {},
) {
  const perguntou: { anteriores: PerguntaSpec[]; texto: string; origem: string }[] = [];
  const entradas: { requestId: string; followUp: string | undefined }[] = [];
  const gravadas: unknown[] = [];
  const portas: PortasSpec = {
    perguntas: async () => perguntas,
    cartao: vi.fn(async () => ({ card: cardCompleto, comments: [], attachments: [] })),
    conhecimento: async () => undefined,
    revisaoDaSpec: async () => 2,
    configuracao: () => ({
      questionApproval: config.questionApproval ?? false,
      specApproval: config.specApproval ?? false,
    }),
    perguntar: async (anteriores, texto, origem) => {
      perguntou.push({ anteriores, texto, origem });
    },
    pedirSpec: vi.fn(async (entrada) => {
      entradas.push({ requestId: entrada.requestId, followUp: entrada.followUp });
      return resultado;
    }),
    gravarEntrega: async (e) => {
      gravadas.push(e);
    },
  };
  return { portas, perguntou, entradas, gravadas };
}

const respondida = (origin: PerguntaSpec["origin"], answer: string | null = "sim"): PerguntaSpec => ({
  n: 1,
  text: "Qual o prazo?",
  answer,
  origin,
});

describe("SPEC: espera e card raso", () => {
  it("pergunta sem resposta mantém a espera, sem ler o card", async () => {
    const { portas } = portasFalsas([respondida("grill", null)], { kind: "entrega", delivery: entrega });
    expect(await conduzirSpec(portas)).toBe("aguardar");
    expect(portas.cartao).not.toHaveBeenCalled();
  });

  it("card raso sem perguntas gera a pergunta própria antes de qualquer SPEC", async () => {
    const curto = { ...cardCompleto, description: "ajuda" } as unknown as Card;
    const { portas, perguntou } = portasFalsas([], { kind: "entrega", delivery: entrega });
    (portas.cartao as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ card: curto, comments: [], attachments: [] });
    expect(await conduzirSpec(portas)).toBe("aguardar");
    expect(perguntou).toEqual([{ anteriores: [], texto: SHALLOW_CARD_QUESTION, origem: "card-raso" }]);
    expect(portas.pedirSpec).not.toHaveBeenCalled();
  });
});

describe("SPEC: conversa com o modelo", () => {
  it("resposta do PO à pergunta do grill segue na conversa com o follow-up de negócio", async () => {
    const { portas, entradas } = portasFalsas([respondida("grill", "até sexta")], {
      kind: "entrega",
      delivery: entrega,
    });
    await conduzirSpec(portas);
    expect(entradas[0].followUp).toBe(answerFollowUp({ text: "Qual o prazo?", answer: "até sexta" }));
    expect(entradas[0].requestId).toBe("spec-1-r2");
  });

  it("resposta a pergunta técnica vira follow-up técnico", async () => {
    const { portas, entradas } = portasFalsas([respondida("tecnica", "use o repo X")], {
      kind: "entrega",
      delivery: entrega,
    });
    await conduzirSpec(portas);
    expect(entradas[0].followUp).toContain('Resposta do usuário à pergunta técnica "Qual o prazo?"');
  });

  it("sem perguntas anteriores, não há follow-up", async () => {
    const { portas, entradas } = portasFalsas([], { kind: "entrega", delivery: entrega });
    await conduzirSpec(portas);
    expect(entradas[0].followUp).toBeUndefined();
  });

  it("modelo que pergunta: a pergunta vai ao PO (grill) ou técnica, e a etapa espera", async () => {
    const perguntas = [respondida("grill")];
    const { portas, perguntou } = portasFalsas(perguntas, { kind: "question", text: "E o formato?", technical: false });
    expect(await conduzirSpec(portas)).toBe("aguardar");
    expect(perguntou).toEqual([{ anteriores: perguntas, texto: "E o formato?", origem: "grill" }]);
    const tecnica = portasFalsas([], { kind: "question", text: "Qual repo?", technical: true });
    await conduzirSpec(tecnica.portas);
    expect(tecnica.perguntou[0].origem).toBe("tecnica");
  });
});

describe("SPEC: entrega e ensaio", () => {
  it("entrega pronta é gravada e devolvida", async () => {
    const { portas, gravadas } = portasFalsas([], { kind: "entrega", delivery: entrega });
    expect(await conduzirSpec(portas)).toEqual(entrega);
    expect(gravadas).toEqual([entrega]);
  });

  it("ensaio de revisão sem pergunta do modelo bloqueia a SPEC e não grava", async () => {
    const { portas, gravadas } = portasFalsas(
      [],
      { kind: "entrega", delivery: entrega },
      {
        questionApproval: true,
        specApproval: false,
      },
    );
    await expect(conduzirSpec(portas)).rejects.toBeInstanceOf(SpecBloqueada);
    expect(gravadas).toEqual([]);
  });

  it("falha ao ler o card propaga o erro", async () => {
    const { portas } = portasFalsas([], { kind: "entrega", delivery: entrega });
    (portas.cartao as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("card SF-1 não existe mais"));
    await expect(conduzirSpec(portas)).rejects.toThrow("card SF-1 não existe mais");
  });
});
