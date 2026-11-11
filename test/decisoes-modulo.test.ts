import { describe, expect, it, vi } from "vitest";
import type { QuestionRef } from "../src/channel.js";
import { BusinessCalendar } from "../src/config.js";
import { GuardrailViolation } from "../src/marca-automacao.js";
import {
  criarDecisoes,
  type EstadoDecisoes,
  type EventoDecisao,
  type PortasDecisoes,
  type ProjetoDecisoes,
  type TarefaDecisoes,
} from "../src/packages/decisoes/index.js";

// Decisões humanas com portas falsas: fixa as prévias com revisão, as travas contra envio duplo, o dry-run e a volta
// de uma publicação barrada pelo guardrail. Sem fábrica, sem Canal real, sem Teams.

// Calendário real (padrões do schema): seg a sex, 09h–18h em UTC.
const CALENDARIO = BusinessCalendar.parse({ timezone: "UTC" });

function tarefa(extra: Partial<TarefaDecisoes> = {}): TarefaDecisoes {
  return {
    id: "p/K-1",
    project: "p",
    key: "K-1",
    title: "Título do card",
    status: "aguardando-humano",
    pauseRequested: false,
    ...extra,
  };
}

function estadoCom(...tarefas: TarefaDecisoes[]): EstadoDecisoes {
  return { daemonPaused: false, tasks: tarefas };
}

function portasFalsas(
  estado: EstadoDecisoes,
  opcoes: { dryRun?: boolean; teamsDisponivel?: boolean; canal?: Partial<ProjetoDecisoes["canal"]> } = {},
) {
  const eventos: EventoDecisao[] = [];
  const avisos: unknown[] = [];
  const canal = {
    ask: vi.fn(async (): Promise<QuestionRef> => ({ card: "p/K-1", to: "po", before: [] })),
    remind: vi.fn(async () => undefined),
    ...opcoes.canal,
  };
  const projeto: ProjetoDecisoes = {
    dryRun: opcoes.dryRun ?? false,
    calendario: CALENDARIO,
    baseUrl: "https://jira.exemplo",
    formatMention: (pessoa) => `@${pessoa}`,
    canal,
    // Não usados pelos testes de triagem, SPEC, lembrete e pergunta.
    configuracao: {} as ProjetoDecisoes["configuracao"],
    escritor: {} as ProjetoDecisoes["escritor"],
    pessoaPO: (id) => (id === "po" ? { nome: "Ana Lima", teamsUserId: "u1" } : undefined),
  };
  const portas: PortasDecisoes = {
    estado: async () => estado,
    alterar: async (fn) => fn(estado),
    agora: () => 1_000,
    projeto: (nome) => (nome === "p" ? projeto : undefined),
    projetoPausado: () => false,
    retro: () => ({}),
    previsaoRetro: async () => {
      throw new Error("prévia de retrô não usada nestes testes");
    },
    publicarRetro: async () => undefined,
    teamsDisponivel: opcoes.teamsDisponivel ?? true,
    avisarTeams: async (tarefaId, projetoNome, chave, n) => {
      avisos.push({ tarefaId, projetoNome, chave, n });
    },
    registrarEvento: async (evento) => {
      eventos.push(evento);
    },
  };
  return { decisoes: criarDecisoes(portas), canal, eventos, avisos };
}

const triagemDraft = (overrides: Partial<{ verdict: string; category: string; closeAs?: string }> = {}) =>
  tarefa({
    triage: {
      review: "draft",
      result: {
        verdict: "recusar",
        category: "duplicata",
        reason: "motivo interno",
        by: "modelo",
        duplicateOf: "K-9",
        ...overrides,
      } as never,
    },
  });

describe("Decisões: triagem", () => {
  it("prévia traz o comentário da recusa e o motivo de fechamento, com uma revisão", async () => {
    const { decisoes } = portasFalsas(estadoCom(triagemDraft()));
    const previa = await decisoes.triagem("p/K-1", false, undefined);
    expect(previa.status).toBe(200);
    const corpo = previa.body as Record<string, unknown>;
    expect(corpo.closeAs).toBe("duplicate");
    expect(corpo.comment).toContain("#9");
    expect(corpo.comment).not.toContain("motivo interno");
    expect(typeof corpo.revision).toBe("string");
  });

  it("recusa com revisão antiga responde 409 e não muda a triagem", async () => {
    const estado = estadoCom(triagemDraft());
    const { decisoes } = portasFalsas(estado);
    const r = await decisoes.triagem("p/K-1", true, { decision: "aceitar", revision: "velha" });
    expect(r.status).toBe(409);
    expect(estado.tasks[0].triage?.review).toBe("draft");
  });

  it("aceitar com a revisão atual enfileira a Tarefa", async () => {
    const estado = estadoCom(triagemDraft());
    const { decisoes } = portasFalsas(estado);
    const { revision } = (await decisoes.triagem("p/K-1", false, undefined)).body as { revision: string };
    const r = await decisoes.triagem("p/K-1", true, { decision: "aceitar", revision });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(estado.tasks[0].triage?.review).toBe("aceitar");
    expect(estado.tasks[0].status).toBe("enfileirada");
  });

  it("recusar no dry-run responde 409", async () => {
    const estado = estadoCom(triagemDraft());
    const { decisoes } = portasFalsas(estado, { dryRun: true });
    const { revision } = (await decisoes.triagem("p/K-1", false, undefined)).body as { revision: string };
    const r = await decisoes.triagem("p/K-1", true, { decision: "recusar", revision });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: "publicação real desativada no dry-run" });
  });

  it("Tarefa que não aguarda decisão responde 409 na prévia", async () => {
    const { decisoes } = portasFalsas(estadoCom(tarefa({ status: "enfileirada", triage: triagemDraft().triage })));
    expect((await decisoes.triagem("p/K-1", false, undefined)).status).toBe(409);
  });
});

describe("Decisões: SPEC", () => {
  const comSpec = () =>
    tarefa({
      specReview: "draft",
      delivery: { spec: "Especificação", tickets: [] } as never,
    });

  it("aprovar com a revisão atual marca a SPEC como aprovada e enfileira a Tarefa", async () => {
    const estado = estadoCom(comSpec());
    const { decisoes } = portasFalsas(estado);
    const { revision } = (await decisoes.spec("p/K-1", false, undefined)).body as { revision: string };
    const r = await decisoes.spec("p/K-1", true, { revision });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(estado.tasks[0].specReview).toBe("approved");
    expect(estado.tasks[0].specApprovedDryRun).toBe(false);
    expect(estado.tasks[0].status).toBe("enfileirada");
  });

  it("SPEC pausada volta para pausada, e não para enfileirada", async () => {
    const estado = estadoCom(comSpec());
    estado.tasks[0].pauseRequested = true;
    const { decisoes } = portasFalsas(estado);
    const { revision } = (await decisoes.spec("p/K-1", false, undefined)).body as { revision: string };
    await decisoes.spec("p/K-1", true, { revision });
    expect(estado.tasks[0].status).toBe("pausada");
  });
});

describe("Decisões: lembrete de pergunta", () => {
  const comPergunta = (extra: Record<string, unknown> = {}) =>
    tarefa({
      questions: [
        {
          n: 1,
          origin: "grill",
          to: "po",
          text: "Qual o prazo?",
          ref: { card: "p/K-1", to: "po", before: [] },
          answer: null,
          reminder: "draft",
          ...extra,
        } as never,
      ],
    });

  it("envia o lembrete pelo Canal, marca como enviado e registra o evento", async () => {
    const estado = estadoCom(comPergunta());
    const { decisoes, canal, eventos } = portasFalsas(estado);
    const { revision } = (await decisoes.lembrete("p/K-1", 1, false, undefined)).body as { revision: string };
    const r = await decisoes.lembrete("p/K-1", 1, true, { revision });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(canal.remind).toHaveBeenCalledTimes(1);
    expect(estado.tasks[0].questions?.[0].reminder).toBe("sent");
    expect(eventos).toEqual([expect.objectContaining({ type: "question", n: 1, status: "lembrete" })]);
  });

  it("guardrail que barra o envio devolve a pergunta a rascunho", async () => {
    const estado = estadoCom(comPergunta());
    const { decisoes } = portasFalsas(estado, {
      canal: { remind: vi.fn(async () => Promise.reject(new GuardrailViolation("vaza segredo"))) },
    });
    const { revision } = (await decisoes.lembrete("p/K-1", 1, false, undefined)).body as { revision: string };
    const r = await decisoes.lembrete("p/K-1", 1, true, { revision });
    expect(r).toEqual({ status: 409, body: { error: "publicação barrada: vaza segredo" } });
    expect(estado.tasks[0].questions?.[0].reminder).toBe("draft");
  });

  it("no dry-run não envia e responde 409", async () => {
    const estado = estadoCom(comPergunta());
    const { decisoes, canal } = portasFalsas(estado, { dryRun: true });
    const { revision } = (await decisoes.lembrete("p/K-1", 1, false, undefined)).body as { revision: string };
    const r = await decisoes.lembrete("p/K-1", 1, true, { revision });
    expect(r.status).toBe(409);
    expect(canal.remind).not.toHaveBeenCalled();
  });
});

describe("Decisões: publicação de pergunta ao PO", () => {
  const comPergunta = () =>
    tarefa({
      questions: [
        {
          n: 1,
          origin: "grill",
          to: "po",
          text: "Qual o prazo?",
          ref: { card: "p/K-1", to: "po", before: [] },
          answer: null,
          publication: "draft",
        } as never,
      ],
    });

  it("publica no Canal, agenda lembrete e aviso, avisa o Teams e registra o evento", async () => {
    const estado = estadoCom(comPergunta());
    const { decisoes, canal, eventos, avisos } = portasFalsas(estado);
    const { revision } = (await decisoes.pergunta("p/K-1", 1, false, undefined)).body as { revision: string };
    const r = await decisoes.pergunta("p/K-1", 1, true, { revision });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(canal.ask).toHaveBeenCalledWith(expect.objectContaining({ card: "K-1", to: "po" }));
    const q = estado.tasks[0].questions?.[0];
    expect(q?.publication).toBe("sent");
    expect(q?.askedAt).toBe(1_000);
    expect(q?.teamsNotice).toEqual({ userId: "u1", link: "https://jira.exemplo/browse/K-1", status: "pending" });
    expect(avisos).toEqual([{ tarefaId: "p/K-1", projetoNome: "p", chave: "K-1", n: 1 }]);
    expect(eventos).toEqual([expect.objectContaining({ status: "enviada" })]);
  });

  it("PO com Teams sem Teams configurado responde 409 e nada é enviado", async () => {
    const estado = estadoCom(comPergunta());
    const { decisoes, canal } = portasFalsas(estado, { teamsDisponivel: false });
    const { revision } = (await decisoes.pergunta("p/K-1", 1, false, undefined)).body as { revision: string };
    const r = await decisoes.pergunta("p/K-1", 1, true, { revision });
    expect(r).toEqual({ status: 409, body: { error: "Teams indisponível" } });
    expect(canal.ask).not.toHaveBeenCalled();
  });

  it("segunda aprovação enquanto a primeira publica responde 409 (trava contra envio duplo)", async () => {
    const estado = estadoCom(comPergunta());
    let liberar!: () => void;
    const { decisoes, canal } = portasFalsas(estado, {
      canal: {
        ask: vi.fn(
          () =>
            new Promise<QuestionRef>((resolver) => {
              liberar = () => resolver({ card: "p/K-1", to: "po", before: [] });
            }),
        ),
      },
    });
    const { revision } = (await decisoes.pergunta("p/K-1", 1, false, undefined)).body as { revision: string };
    const primeira = decisoes.pergunta("p/K-1", 1, true, { revision });
    await vi.waitFor(() => expect(canal.ask).toHaveBeenCalledTimes(1));
    const segunda = await decisoes.pergunta("p/K-1", 1, true, { revision });
    expect(segunda).toEqual({ status: 409, body: { error: "pergunta já está sendo publicada" } });
    liberar();
    expect((await primeira).status).toBe(200);
  });
});

describe("Decisões: retrô e configuração do repositório", () => {
  it("proposta de retrô responde 404 quando a Tarefa não tem a proposta", async () => {
    const { decisoes } = portasFalsas(estadoCom(tarefa()));
    expect((await decisoes.proposta("p/K-1", "spec", 1, false, undefined)).status).toBe(404);
  });

  it("configuração do repositório executa a operação e devolve o resultado dela", async () => {
    const { decisoes } = portasFalsas(estadoCom(tarefa()));
    const r = await decisoes.configurarRepositorioRetro(async () => ({ status: 200, body: { repo: "dono/nome" } }));
    expect(r).toEqual({ status: 200, body: { repo: "dono/nome" } });
  });

  it("enquanto a configuração roda, uma proposta de retrô responde 409 (trava compartilhada)", async () => {
    const { decisoes } = portasFalsas(estadoCom(tarefa()));
    let fim!: () => void;
    const emCurso = decisoes.configurarRepositorioRetro(
      () =>
        new Promise((resolver) => {
          fim = () => resolver({ status: 200, body: { ok: true } });
        }),
    );
    const durante = await decisoes.proposta("p/K-1", "spec", 1, true, { revision: "x" });
    expect(durante).toEqual({ status: 409, body: { error: "uma proposta já está sendo publicada; tente novamente" } });
    fim();
    await emCurso;
  });

  it("enquanto a configuração roda, outra configuração responde 409", async () => {
    const { decisoes } = portasFalsas(estadoCom(tarefa()));
    let fim!: () => void;
    const primeira = decisoes.configurarRepositorioRetro(
      () =>
        new Promise((resolver) => {
          fim = () => resolver({ status: 200, body: { ok: true } });
        }),
    );
    const segunda = await decisoes.configurarRepositorioRetro(async () => ({ status: 200, body: { ok: true } }));
    expect(segunda.status).toBe(409);
    fim();
    expect((await primeira).status).toBe(200);
  });
});
