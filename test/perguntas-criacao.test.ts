import { describe, expect, it, vi } from "vitest";
import { BusinessCalendar } from "../src/config.js";
import {
  type ConfiguracaoPergunta,
  levarPergunta,
  MAX_PERGUNTAS_PO,
  PerguntaBloqueada,
  type PerguntaCriada,
  type PortasCriacao,
} from "../src/packages/perguntas/index.js";

// Criação de perguntas com portas falsas: fixa destinatário, limite, prazos em horas úteis, prazo técnico, rascunho
// com aprovação, aviso ao Teams e os bloqueios. Sem Canal real, sem fábrica.

const CALENDARIO = BusinessCalendar.parse({ timezone: "UTC" });
const AGORA = Date.UTC(2026, 0, 5, 10, 0, 0); // segunda-feira, 10h

const alvo = { id: "p/K-1", projeto: "p", chave: "K-1" };

function portasFalsas(config: Partial<ConfiguracaoPergunta> = {}, sobrescritas: Partial<PortasCriacao> = {}) {
  const gravadas: PerguntaCriada[] = [];
  const eventos: unknown[] = [];
  const avisos: unknown[] = [];
  const perguntarNoCanal = vi.fn(async () => ({ card: "K-1", to: "po", before: [] }));
  const portas: PortasCriacao = {
    configuracao: () => ({
      dryRun: false,
      questionApproval: false,
      baseUrl: "https://jira.exemplo",
      calendario: CALENDARIO,
      teamsDisponivel: true,
      ...config,
    }),
    destinatario: (_projeto, tecnica) => (tecnica ? { id: "tech" } : { id: "po", teamsUserId: "u-po" }),
    validarDestinatarioTecnico: () => undefined,
    perguntarNoCanal,
    prazoPerguntaTecnica: (instante) => instante + 120 * 60_000,
    agora: () => AGORA,
    gravar: async (_id, pergunta) => {
      gravadas.push(pergunta);
    },
    avisarTeams: async (...args) => {
      avisos.push(args);
    },
    registrarEnviada: async (evento) => {
      eventos.push(evento);
    },
    ...sobrescritas,
  };
  return { portas, gravadas, eventos, avisos, perguntarNoCanal };
}

describe("Perguntas: criação", () => {
  it("pergunta do grill vai pelo Canal, lembra em 4 horas úteis e avisa o Teams", async () => {
    const { portas, gravadas, eventos, avisos, perguntarNoCanal } = portasFalsas();
    await levarPergunta(portas, alvo, [], "Qual o prazo?", "grill");
    expect(perguntarNoCanal).toHaveBeenCalledWith({ card: "K-1", to: "po", text: "Pergunta 1: Qual o prazo?" });
    const [q] = gravadas;
    expect(q).toMatchObject({ n: 1, origin: "grill", to: "po", text: "Qual o prazo?", answer: null, reminded: false });
    expect(q.askedAt).toBe(AGORA);
    // Segunda 10h + 4 horas úteis = segunda 14h.
    expect(q.remindAt).toBe(Date.UTC(2026, 0, 5, 14, 0, 0));
    expect(q.publication).toBeUndefined();
    expect(q.teamsNotice).toEqual({ userId: "u-po", link: "https://jira.exemplo/browse/K-1", status: "pending" });
    expect(avisos).toEqual([["p/K-1", "p", "K-1", 1]]);
    expect(eventos).toEqual([expect.objectContaining({ type: "question", n: 1, status: "enviada" })]);
  });

  it("pergunta técnica não passa pelo Canal, usa o prazo técnico e não tem aviso ao Teams", async () => {
    const { portas, gravadas, perguntarNoCanal, avisos } = portasFalsas();
    await levarPergunta(portas, alvo, [], "Qual repositório?", "tecnica", "repositorio");
    expect(perguntarNoCanal).not.toHaveBeenCalled();
    expect(gravadas[0]).toMatchObject({ to: "tech", origin: "tecnica", purpose: "repositorio" });
    expect(gravadas[0].remindAt).toBe(AGORA + 120 * 60_000);
    expect(gravadas[0].teamsNotice).toBeUndefined();
    expect(avisos).toHaveLength(1);
  });

  it("com aprovação de perguntas, a pergunta fica em rascunho: sem Canal, sem aviso e sem evento", async () => {
    const { portas, gravadas, perguntarNoCanal, avisos, eventos } = portasFalsas({ questionApproval: true });
    await levarPergunta(portas, alvo, [], "Qual o prazo?", "grill");
    expect(perguntarNoCanal).not.toHaveBeenCalled();
    expect(gravadas[0].publication).toBe("draft");
    expect(avisos).toEqual([]);
    expect(eventos).toEqual([]);
  });

  it("em dry-run não há aviso ao Teams com link, mas a pergunta sai", async () => {
    const { portas, gravadas, avisos } = portasFalsas({ dryRun: true });
    await levarPergunta(portas, alvo, [], "Qual o prazo?", "grill");
    expect(gravadas[0].teamsNotice).toBeUndefined();
    expect(avisos).toHaveLength(1);
  });

  it("numeração segue as perguntas anteriores", async () => {
    const { portas, gravadas } = portasFalsas();
    await levarPergunta(portas, alvo, [{ n: 1 }, { n: 2 }], "Terceira?", "grill");
    expect(gravadas[0].n).toBe(3);
  });

  it("sem PO configurado, bloqueia com a mensagem do projeto", async () => {
    const { portas } = portasFalsas({}, { destinatario: () => undefined });
    await expect(levarPergunta(portas, alvo, [], "Oi?", "grill")).rejects.toThrow(
      "o grill precisa perguntar ao PO, mas o projeto p não declara um",
    );
    await expect(levarPergunta(portas, alvo, [], "Oi?", "grill")).rejects.toBeInstanceOf(PerguntaBloqueada);
  });

  it("aviso ao Teams sem origem Jira ou conexão MCP bloqueia a pergunta do grill", async () => {
    const { portas, perguntarNoCanal } = portasFalsas({ baseUrl: undefined });
    await expect(levarPergunta(portas, alvo, [], "Oi?", "grill")).rejects.toThrow(
      "aviso ao PO no Teams configurado sem origem Jira ou conexão MCP",
    );
    expect(perguntarNoCanal).not.toHaveBeenCalled();
  });

  it("limite de perguntas ao PO bloqueia a próxima", async () => {
    const anteriores = Array.from({ length: MAX_PERGUNTAS_PO }, (_, i) => ({ n: i + 1 }));
    const { portas, gravadas } = portasFalsas();
    await expect(levarPergunta(portas, alvo, anteriores, "Mais uma?", "grill")).rejects.toThrow(
      `o grill já fez ${MAX_PERGUNTAS_PO} perguntas ao PO`,
    );
    expect(gravadas).toEqual([]);
  });

  it("destinatário técnico inválido bloqueia com a mensagem da validação", async () => {
    const { portas } = portasFalsas(
      {},
      {
        validarDestinatarioTecnico: () => {
          throw new Error("responsável técnico não é pessoa do projeto");
        },
      },
    );
    await expect(levarPergunta(portas, alvo, [], "Qual repo?", "tecnica")).rejects.toThrow(
      "responsável técnico não é pessoa do projeto",
    );
  });
});
