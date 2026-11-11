import { describe, expect, it, vi } from "vitest";
import { criarEscalonador, type EstadoEscalonador, type PortasEscalonador } from "../src/packages/escalonador/index.js";

// Escalonador com portas falsas: fixa a serialização de buscas e sincronizações, o registro de mudanças de status, a
// escolha da próxima Tarefa e o encerramento. Sem fábrica, sem banco, sem relógio real.

type Tarefa = EstadoEscalonador["tasks"][number];

const tarefa = (id: string, extra: Partial<Tarefa> = {}): Tarefa => ({
  id,
  project: id.split("/")[0] ?? "p",
  key: id.split("/")[1] ?? "K-1",
  status: "enfileirada",
  pauseRequested: false,
  notBefore: null,
  reason: null,
  ...extra,
});

/** Portas falsas com um estado mutável: `ativar` muda o status da Tarefa, como a fábrica faz no commit. */
function portasFalsas(tarefas: Tarefa[], sobrescritas: Partial<PortasEscalonador> = {}) {
  const estado: EstadoEscalonador = { daemonPaused: false, tasks: tarefas };
  const timers: { fn: () => void; ms: number }[] = [];
  let agora = 1_000;
  const eventos: unknown[] = [];
  const portas: PortasEscalonador = {
    buscar: vi.fn(async () => undefined),
    estado: async () => estado,
    agora: () => agora,
    armTimer: vi.fn((fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return () => undefined;
    }),
    proximaAtividade: (_projeto, momento) => momento,
    projetoConfigurado: () => true,
    pendenciasBloqueantes: () => [],
    repoDesativado: () => false,
    projetoPausado: () => false,
    ativar: vi.fn(async (id: string) => {
      const alvo = estado.tasks.find((t) => t.id === id);
      if (alvo) alvo.status = "ativa";
    }),
    registrarEvento: vi.fn(async (evento: unknown) => {
      eventos.push(evento);
    }),
    registrarErro: vi.fn(),
    ...sobrescritas,
  };
  return {
    portas,
    estado,
    timers,
    eventos,
    avancar: (ms: number) => {
      agora += ms;
    },
  };
}

/** Primeira Tarefa do estado de teste; falha com clareza se o teste não criou nenhuma. */
function primeiraTarefa(estado: EstadoEscalonador): Tarefa {
  const t = estado.tasks[0];
  if (!t) throw new Error("o teste precisa de ao menos uma Tarefa");
  return t;
}

/** Promessa que o teste resolve à mão, para segurar uma busca no meio. */
function travada() {
  let liberar: () => void = () => undefined;
  const promessa = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  return { promessa, liberar };
}

describe("serialização de buscas e sincronizações", () => {
  it("duas buscas pedidas ao mesmo tempo rodam uma depois da outra", async () => {
    let emCurso = 0;
    let maximo = 0;
    const buscar = vi.fn(async () => {
      emCurso++;
      maximo = Math.max(maximo, emCurso);
      await new Promise((r) => setTimeout(r, 5));
      emCurso--;
    });
    const { portas } = portasFalsas([], { buscar });
    const escalonador = await criarEscalonador(portas);

    await Promise.all([escalonador.pedirBusca(), escalonador.pedirBusca()]);

    expect(buscar).toHaveBeenCalledTimes(2);
    expect(maximo).toBe(1);
  });

  it("um pedido de busca feito durante outra busca não se perde: roda depois dela", async () => {
    const primeira = travada();
    const buscar = vi
      .fn()
      .mockImplementationOnce(() => primeira.promessa)
      .mockImplementation(async () => undefined);
    const { portas } = portasFalsas([], { buscar });
    const escalonador = await criarEscalonador(portas);

    const em1 = escalonador.pedirBusca();
    const em2 = escalonador.pedirBusca();
    expect(escalonador.buscasPendentes()).toBe(2);
    primeira.liberar();
    await Promise.all([em1, em2]);

    expect(buscar).toHaveBeenCalledTimes(2);
    expect(escalonador.buscasPendentes()).toBe(0);
  });

  it("sincronização e busca não se sobrepõem, e a sincronização não conta como busca pendente", async () => {
    const primeira = travada();
    let sincronizando = false;
    let simultaneo = false;
    const buscar = vi.fn(async () => {
      if (sincronizando) simultaneo = true;
    });
    const { portas } = portasFalsas([], { buscar });
    const escalonador = await criarEscalonador(portas);

    const sync = escalonador.sincronizar(async () => {
      sincronizando = true;
      await primeira.promessa;
      sincronizando = false;
    });
    const busca = escalonador.pedirBusca();
    expect(escalonador.buscasPendentes()).toBe(1);
    primeira.liberar();
    await Promise.all([sync, busca]);

    expect(simultaneo).toBe(false);
  });
});

describe("registro de mudanças de status", () => {
  it("uma mudança vira um evento; uma reação seguinte sem mudança não emite nada", async () => {
    const { portas, estado, eventos } = portasFalsas([tarefa("p/K-1")]);
    const escalonador = await criarEscalonador(portas);
    primeiraTarefa(estado).status = "bloqueada";

    escalonador.pedirReacao();
    await escalonador.ociosa();
    escalonador.pedirReacao();
    await escalonador.ociosa();

    expect(eventos).toEqual([expect.objectContaining({ type: "task", id: "p/K-1", status: "bloqueada" })]);
  });

  it("o acompanhamento do PR (aguardando-entrega, ativa, aguardando-entrega) não repete o aviso", async () => {
    const { portas, estado, eventos } = portasFalsas([tarefa("p/K-1")]);
    const escalonador = await criarEscalonador(portas);
    const observado = (status: string) => {
      primeiraTarefa(estado).status = status;
      escalonador.pedirReacao();
      return escalonador.ociosa();
    };

    await observado("aguardando-entrega");
    await observado("ativa");
    await observado("aguardando-entrega");

    expect(eventos).toEqual([expect.objectContaining({ type: "task", status: "aguardando-entrega" })]);
  });

  it("pedidos de reação durante outra reação geram uma reação final que vê a mudança", async () => {
    const { portas, estado, eventos } = portasFalsas([tarefa("p/K-1")]);
    const escalonador = await criarEscalonador(portas);
    primeiraTarefa(estado).status = "bloqueada";

    escalonador.pedirReacao();
    escalonador.pedirReacao();
    escalonador.pedirReacao();
    await escalonador.ociosa();

    expect(eventos).toHaveLength(1);
  });
});

describe("escolha da próxima Tarefa", () => {
  it("ativa só a primeira Tarefa elegível, uma por vez", async () => {
    const { portas, estado } = portasFalsas([tarefa("p/A-1"), tarefa("p/A-2")]);
    const escalonador = await criarEscalonador(portas);

    escalonador.pedirReacao();
    await escalonador.ociosa();

    expect(portas.ativar).toHaveBeenCalledTimes(1);
    expect(portas.ativar).toHaveBeenCalledWith("p/A-1");
    expect(estado.tasks.map((t) => t.status)).toEqual(["ativa", "enfileirada"]);
  });

  it("não ativa com o daemon pausado nem com outra Tarefa já ativa", async () => {
    const pausado = portasFalsas([tarefa("p/A-1")]);
    pausado.estado.daemonPaused = true;
    const e1 = await criarEscalonador(pausado.portas);
    e1.pedirReacao();
    await e1.ociosa();
    expect(pausado.portas.ativar).not.toHaveBeenCalled();

    const ocupado = portasFalsas([tarefa("p/A-1", { status: "ativa" }), tarefa("p/A-2")]);
    const e2 = await criarEscalonador(ocupado.portas);
    e2.pedirReacao();
    await e2.ociosa();
    expect(ocupado.portas.ativar).not.toHaveBeenCalled();
  });

  it("Tarefa com notBefore no futuro não roda agora: agenda o despertar e ativa quando ele chega", async () => {
    const { portas, timers, avancar } = portasFalsas([tarefa("p/A-1", { notBefore: 5_000 })]);
    const escalonador = await criarEscalonador(portas);

    escalonador.pedirReacao();
    await escalonador.ociosa();
    expect(portas.ativar).not.toHaveBeenCalled();
    expect(timers).toEqual([{ fn: expect.any(Function), ms: 4_000 }]);

    avancar(4_000);
    timers[0]?.fn();
    await escalonador.ociosa();
    expect(portas.ativar).toHaveBeenCalledWith("p/A-1");
  });

  it("repositório desativado, projeto pausado e pendências impedem a ativação", async () => {
    const barradas = [
      { repoDesativado: () => true },
      { projetoPausado: () => true },
      { pendenciasBloqueantes: () => ["falta o PO"] },
    ];
    for (const sobrescrita of barradas) {
      const { portas } = portasFalsas([tarefa("p/A-1")], sobrescrita);
      const escalonador = await criarEscalonador(portas);
      escalonador.pedirReacao();
      await escalonador.ociosa();
      expect(portas.ativar).not.toHaveBeenCalled();
    }
  });

  it("Tarefa de projeto não configurado gera um erro só, mesmo em reações seguidas", async () => {
    const { portas, eventos } = portasFalsas([tarefa("fantasma/A-1")], { projetoConfigurado: () => false });
    const escalonador = await criarEscalonador(portas);

    escalonador.pedirReacao();
    await escalonador.ociosa();
    escalonador.pedirReacao();
    await escalonador.ociosa();

    expect(eventos).toEqual([expect.objectContaining({ type: "error", project: "fantasma", target: "A-1" })]);
  });
});

describe("encerramento", () => {
  it("parar desarma o despertar, impede novas reações e espera as que já rodam", async () => {
    const { portas, timers, estado } = portasFalsas([tarefa("p/A-1", { notBefore: 5_000 })]);
    const escalonador = await criarEscalonador(portas);
    escalonador.pedirReacao();
    await escalonador.ociosa();
    expect(timers).toHaveLength(1);

    escalonador.parar();
    primeiraTarefa(estado).notBefore = null;
    escalonador.pedirReacao();
    await escalonador.ociosa();

    expect(portas.ativar).not.toHaveBeenCalled();
  });
});
