import { describe, expect, it, vi } from "vitest";
import {
  createApiLocal,
  criarRotasApi,
  type FactoryCommands,
  type Pedido,
  type Resposta,
} from "../src/packages/api-local/index.js";

// Adaptador da API local com comandos falsos: o teste fixa o que cada rota de Tarefa pede aos comandos e como traduz
// a resposta. As regras de cada comando são testadas na fábrica, pelos testes de HTTP que já existem.

const HOSTS = new Set(["localhost:7420"]);

/** Comandos falsos: cada método é um `vi.fn` que responde 200 por padrão. */
function comandosFalsos(sobrescritos: Partial<Record<string, unknown>> = {}) {
  const resposta200 = () => vi.fn(async () => ({ status: 200, body: { ok: true } }));
  const base: Record<string, unknown> = {
    pause: vi.fn(async () => true),
    resume: vi.fn(async () => true),
    cancel: vi.fn(async () => true),
    veto: vi.fn(async () => "vetada"),
    reorder: vi.fn(async () => undefined),
    setDaemonPaused: vi.fn(async () => undefined),
    answerQuestion: vi.fn(async () => true),
    tarefa: resposta200(),
    trace: resposta200(),
    esquecerMemoria: resposta200(),
    mensagemEtapa: resposta200(),
    previaReparo: resposta200(),
    aplicarReparo: resposta200(),
    previaTriagem: resposta200(),
    decidirTriagem: resposta200(),
    previaSpec: resposta200(),
    aprovarSpec: resposta200(),
    previaLembrete: resposta200(),
    aprovarLembrete: resposta200(),
    responderPergunta: resposta200(),
    previaPergunta: resposta200(),
    aprovarPergunta: resposta200(),
    previaRetro: resposta200(),
    aprovarRetro: resposta200(),
    poll: resposta200(),
    ...sobrescritos,
  };
  return base as unknown as FactoryCommands & Record<string, ReturnType<typeof vi.fn>>;
}

function api(comandos: FactoryCommands) {
  return createApiLocal({
    hosts: () => HOSTS,
    rotas: criarRotasApi(comandos),
  });
}

const pedido = (metodo: string, caminho: string, corpo?: unknown, contentType?: string): Pedido => ({
  metodo,
  caminho,
  host: "localhost:7420",
  contentType,
  corpo: async () => corpo,
});

const JSON_CT = "application/json";

describe("rotas de Tarefa: comandos e tradução", () => {
  it("GET /tasks/{project}/{key} pede a Tarefa decodificada e devolve a resposta do comando", async () => {
    const comandos = comandosFalsos();
    const r = await api(comandos).tratar(pedido("GET", "/tasks/exemplo/PROJ%2D1"));
    expect(comandos.tarefa).toHaveBeenCalledWith("exemplo/PROJ-1");
    expect(r).toEqual({ status: 200, body: { ok: true } });
  });

  it("pausar, retomar e cancelar: 404 com a mensagem quando o comando diz que a Tarefa não existe", async () => {
    const comandos = comandosFalsos({ pause: vi.fn(async () => false) });
    const r = await api(comandos).tratar(pedido("POST", "/tasks/exemplo/PROJ-9/pause"));
    expect(r).toEqual({ status: 404, body: { error: "Tarefa exemplo/PROJ-9 não existe" } });
  });

  it("veto: traduz o resultado do comando para o código HTTP", async () => {
    const comandos = comandosFalsos({ veto: vi.fn(async () => "fora-do-prazo") });
    const r = await api(comandos).tratar(pedido("POST", "/tasks/exemplo/PROJ-1/veto"));
    expect((r as Resposta | undefined)?.status).toBe(409);
  });

  it("POST sem JSON é recusado com 415 antes de chegar ao comando", async () => {
    const comandos = comandosFalsos();
    const r = await api(comandos).tratar(pedido("POST", "/tasks/order", { ids: [] }, "text/plain"));
    expect(r).toEqual({ status: 415, body: { error: "envie Content-Type: application/json" } });
    expect(comandos.reorder).not.toHaveBeenCalled();
  });

  it("decisão de triagem: o corpo vai inteiro ao comando, que decide a validação de estado", async () => {
    const comandos = comandosFalsos();
    const corpo = { revision: "abc", decision: "aceitar" };
    await api(comandos).tratar(pedido("POST", "/tasks/exemplo/PROJ-1/triage/decide", corpo, JSON_CT));
    expect(comandos.decidirTriagem).toHaveBeenCalledWith("exemplo/PROJ-1", corpo);
  });

  it("prévia e aprovação são rotas separadas: GET da prévia não aprova, e o approve não tem prévia", async () => {
    const comandos = comandosFalsos();
    const adaptador = api(comandos);
    await adaptador.tratar(pedido("GET", "/tasks/exemplo/PROJ-1/spec"));
    expect(comandos.previaSpec).toHaveBeenCalledWith("exemplo/PROJ-1");
    expect(comandos.aprovarSpec).not.toHaveBeenCalled();
    // Combinações inexistentes não casam: o roteador da fábrica responde 404 "rota inexistente".
    expect(await adaptador.tratar(pedido("POST", "/tasks/exemplo/PROJ-1/spec"))).toBeUndefined();
    expect(await adaptador.tratar(pedido("GET", "/tasks/exemplo/PROJ-1/spec/approve"))).toBeUndefined();
  });

  it("resposta a pergunta: texto vazio ou longo demais é 400 e não chega ao comando", async () => {
    const comandos = comandosFalsos();
    const r = await api(comandos).tratar(pedido("POST", "/tasks/e/k/questions/2/answer", { answer: "  " }, JSON_CT));
    expect((r as Resposta | undefined)?.status).toBe(400);
    expect(comandos.responderPergunta).not.toHaveBeenCalled();
  });

  it("resposta a pergunta: texto válido vai aparado ao comando com o número da pergunta", async () => {
    const comandos = comandosFalsos();
    await api(comandos).tratar(pedido("POST", "/tasks/e/k/questions/2/answer", { answer: " sim " }, JSON_CT));
    expect(comandos.responderPergunta).toHaveBeenCalledWith("e/k", 2, "sim");
  });

  it("mensagem a uma etapa: exige texto não vazio e passa etapa e texto aparado", async () => {
    const comandos = comandosFalsos();
    const adaptador = api(comandos);
    expect(
      (
        (await adaptador.tratar(pedido("POST", "/tasks/e/k/etapas/spec/mensagem", { texto: "  " }, JSON_CT))) as
          | Resposta
          | undefined
      )?.status,
    ).toBe(400);
    await adaptador.tratar(pedido("POST", "/tasks/e/k/etapas/spec/mensagem", { texto: " oi " }, JSON_CT));
    expect(comandos.mensagemEtapa).toHaveBeenCalledWith("e/k", "spec", "oi");
  });

  it("poll é um comando sem corpo", async () => {
    const comandos = comandosFalsos();
    await api(comandos).tratar(pedido("POST", "/poll"));
    expect(comandos.poll).toHaveBeenCalledOnce();
  });
});
