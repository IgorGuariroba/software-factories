import { describe, expect, it } from "vitest";
import { ProjectConfig } from "../src/config.js";
import type { FactoryState } from "../src/durable.js";
import type { GitHubAppStatus } from "../src/github-app.js";
import { createProjetos, type EstadoProjetos, type PortasProjetos } from "../src/packages/projetos/index.js";
import { aguardandoConfirmacao, comConfirmacaoPendente } from "../src/projeto-fonte.js";
import { projetoPausado } from "../src/projeto-pausa.js";
import { projetosReservados } from "../src/projeto-remocao.js";
import {
  ativarProjeto,
  desativarProjeto,
  repoDesativado,
  tarefasAtivas,
  tarefasEmAndamento,
} from "../src/repositorios.js";

// Testes do módulo de Projetos pela sua interface de entrada, com portas falsas. Nada de HTTP nem daemon.

const referencia = {
  name: "sf",
  source: {
    type: "github",
    project: "SF",
    repo: "dono/sf",
    assignee: "dono",
    triageApproval: true,
    maxActive: 3,
    ignoreLabels: ["epic"],
  },
  roles: { spec: { provider: "openai", model: "gpt" }, reviewer: { provider: "openrouter", model: "claude" } },
  statuses: { aberta: "todo", fechada: "done" },
} as unknown as ProjectConfig;

const app: GitHubAppStatus = {
  configurado: true,
  consultadoEm: "2026-11-10T00:00:00.000Z",
  instalacoes: [
    {
      id: 7,
      conta: "dono",
      selecao: "all",
      repositorios: ["dono/novo"],
      catalogo: [{ id: 42, nome: "dono/novo", dono: "dono", privado: false, instalacaoId: 7 }],
    },
  ],
};

const corpoGithub = {
  repoId: 42,
  nome: "novo",
  fonte: { type: "github", project: "NV", assignee: "dono" },
  horario: "business-hours" as const,
  ensaio: true,
  comandoTeste: [],
};

function estadoVazio(): EstadoProjetos {
  return { daemonPaused: false, tasks: [] } as unknown as EstadoProjetos;
}

/** Regras reais, expostas à interface do módulo como a fábrica faz: as funções leem o mesmo objeto de estado. */
const regrasReais = {
  projetosReservados: (s: unknown) => projetosReservados(s as FactoryState),
  repoDesativado: (s: unknown, p: string) => repoDesativado(s as FactoryState, p),
  projetoPausado: (s: unknown, p: string) => projetoPausado(s as FactoryState, p),
  tarefasAtivas: (s: unknown, p: string) => tarefasAtivas(s as FactoryState, p),
  tarefasEmAndamento: (s: unknown, p: string) => tarefasEmAndamento(s as FactoryState, p),
  ativarProjeto: (opts: { state: unknown; project: string; repo: string }) =>
    ativarProjeto({ ...opts, state: opts.state as FactoryState }),
  desativarProjeto: (opts: { state: unknown; project: string; repo: string; motivo: string; force: boolean }) =>
    desativarProjeto({ ...opts, state: opts.state as FactoryState }),
  aguardandoConfirmacao: (s: unknown, p: string) => aguardandoConfirmacao(s as FactoryState, p),
  comConfirmacaoPendente: (pendencias: string[], s: unknown, p: string) =>
    comConfirmacaoPendente(pendencias, s as FactoryState, p),
};

function portasFalsas(sobrescritas: Partial<PortasProjetos> = {}) {
  const estado = estadoVazio();
  const registrados: ProjectConfig[] = [];
  const clonados: { repo: string; instalacaoId: number; destino: string }[] = [];
  const enfileirados: number[] = [];
  const executados: unknown[] = [];
  const portas: PortasProjetos = {
    projetoDoRepositorio: (repo) => (repo === "dono/novo" ? "novo" : undefined),
    pendenciasBloqueantes: () => [],
    regras: regrasReais,
    fabrica: { esquecer: () => undefined },
    importacao: { enfileirar: (repoId) => void enfileirados.push(repoId) },
    efeitos: {
      executar: async (efeitos) => {
        executados.push(...efeitos);
      },
    },
    criacaoHabilitada: true,
    padrao: referencia,
    caminhoDoClone: (nome) => `/dados/repositorios/${nome}`,
    segredos: { has: async () => true, get: async () => "token" },
    github: {
      status: async () => app,
      responsaveisPossiveis: async () => [],
      clonar: async (repo, instalacaoId, destino) => {
        clonados.push({ repo, instalacaoId, destino });
      },
      issuesAbertas: async () => [],
    },
    estado: {
      ler: async () => estado,
      alterar: async (fn) => fn(estado),
    },
    registrar: (config) => {
      registrados.push(config);
    },
    projetosAtivos: () => [],
    agora: () => Date.parse("2026-11-10T12:00:00.000Z"),
    ...sobrescritas,
  };
  return { portas, estado, registrados, clonados, enfileirados, executados };
}

describe("módulo de Projetos: criar projeto de repositório GitHub", () => {
  it("recusa com 409 quando o daemon não cria Fontes pela interface", async () => {
    const { portas, clonados } = portasFalsas({ criacaoHabilitada: false });

    const resposta = await createProjetos(portas).criarGithub(corpoGithub);

    expect(resposta.status).toBe(409);
    expect(clonados).toEqual([]);
  });

  it("recusa com 404 um repositório que não está no catálogo do App", async () => {
    const { portas, clonados } = portasFalsas();

    const resposta = await createProjetos(portas).criarGithub({ ...corpoGithub, repoId: 999 });

    expect(resposta.status).toBe(404);
    expect(clonados).toEqual([]);
  });

  it("recusa com 409 um nome que já existe, antes de clonar", async () => {
    const { portas, clonados } = portasFalsas({
      projetosAtivos: () => [{ ...referencia, name: "novo" } as ProjectConfig],
    });

    const resposta = await createProjetos(portas).criarGithub(corpoGithub);

    expect(resposta.status).toBe(409);
    expect(clonados).toEqual([]);
  });

  it("cria: clona o repositório, grava a configuração e registra o projeto na fábrica", async () => {
    const { portas, estado, registrados, clonados } = portasFalsas();

    const resposta = await createProjetos(portas).criarGithub(corpoGithub);

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ projeto: "novo", repo: "dono/novo", ensaio: true });
    expect(clonados).toEqual([{ repo: "dono/novo", instalacaoId: 7, destino: "/dados/repositorios/novo" }]);
    expect(registrados.map((c) => c.name)).toEqual(["novo"]);
    const gravado = estado as unknown as {
      projetos: Record<string, string>;
      projetosGitHub: Record<string, string>;
      repos: Record<string, { repo: string; status: string }>;
    };
    expect(Object.keys(gravado.projetos)).toEqual(["novo"]);
    expect(Object.keys(gravado.projetosGitHub)).toEqual(["novo"]);
    expect(gravado.repos.novo).toMatchObject({ repo: "dono/novo", status: "ativo" });
  });

  it("falha na clonagem: responde 502, não grava nada e não registra o projeto", async () => {
    const { portas, estado, registrados } = portasFalsas({
      github: {
        status: async () => app,
        responsaveisPossiveis: async () => [],
        issuesAbertas: async () => [],
        clonar: async () => {
          throw new Error("falha de rede");
        },
      },
    });

    const resposta = await createProjetos(portas).criarGithub(corpoGithub);

    expect(resposta.status).toBe(502);
    expect(registrados).toEqual([]);
    expect((estado as unknown as { projetos?: unknown }).projetos).toBeUndefined();
  });
});

describe("módulo de Projetos: criar projeto de repositório GitLab", () => {
  const corpoGitlab = {
    nome: "gl",
    caminho: "grupo/projeto",
    servidor: "",
    fonte: { credential: "gl-token", project: "GL", assignee: "dono" },
    horario: "business-hours" as const,
    ensaio: true,
    comandoTeste: [],
  };

  const gitlabComResposta = (status: number) => (async () => new Response(null, { status })) as typeof fetch;

  it("recusa com 409 quando o daemon não cria Fontes pela interface", async () => {
    const { portas, clonados } = portasFalsas({ criacaoHabilitada: false });

    const resposta = await createProjetos(portas).criarGitlab(corpoGitlab);

    expect(resposta.status).toBe(409);
    expect(clonados).toEqual([]);
  });

  it("recusa com 400 quando falta a credencial do token no cofre", async () => {
    const { portas, clonados } = portasFalsas();

    const resposta = await createProjetos(portas).criarGitlab({ ...corpoGitlab, fonte: { project: "GL" } });

    expect(resposta.status).toBe(400);
    expect(clonados).toEqual([]);
  });

  it("recusa com 400 um repositório inexistente, sem clonar nem gravar", async () => {
    const clonadosGitlab: unknown[] = [];
    const { portas, estado, registrados } = portasFalsas({
      fetchGitlab: gitlabComResposta(404),
      clonarGitlab: async (opts) => {
        clonadosGitlab.push(opts);
      },
    });

    const resposta = await createProjetos(portas).criarGitlab(corpoGitlab);

    expect(resposta.status).toBe(400);
    expect(resposta.body).toMatchObject({ error: expect.stringContaining("não existe") });
    expect(clonadosGitlab).toEqual([]);
    expect(registrados).toEqual([]);
    expect((estado as unknown as { projetos?: unknown }).projetos).toBeUndefined();
  });

  it("cria: clona com o token do cofre, grava e registra o projeto", async () => {
    const clonadosGitlab: { host: string; caminho: string; token: string; destino: string }[] = [];
    const { portas, estado, registrados } = portasFalsas({
      fetchGitlab: gitlabComResposta(200),
      clonarGitlab: async (opts) => {
        clonadosGitlab.push(opts);
      },
    });

    const resposta = await createProjetos(portas).criarGitlab(corpoGitlab);

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ projeto: "gl", fonte: "gitlab" });
    expect(clonadosGitlab).toEqual([
      { host: "gitlab.com", caminho: "grupo/projeto", token: "token", destino: "/dados/repositorios/gl" },
    ]);
    expect(registrados.map((c) => c.name)).toEqual(["gl"]);
    expect(Object.keys((estado as unknown as { projetos: Record<string, string> }).projetos)).toEqual(["gl"]);
  });
});

const estadoDe = (estado: EstadoProjetos) =>
  estado as unknown as {
    tasks: unknown[];
    repos?: Record<string, { repo: string; status: string }>;
    importacoes?: Record<string, { status: string }>;
    projetos?: Record<string, string>;
  };

describe("módulo de Projetos: importar issues de um repositório", () => {
  const corpoImportar = 42;

  it("recusa com 404 um repositório que não está no catálogo do App", async () => {
    const { portas, enfileirados } = portasFalsas();

    const resposta = await createProjetos(portas).importarRepo(999);

    expect(resposta.status).toBe(404);
    expect(enfileirados).toEqual([]);
  });

  it("recusa com 409 quando nenhum projeto monitora o repositório", async () => {
    const { portas, enfileirados } = portasFalsas({ projetoDoRepositorio: () => undefined });

    const resposta = await createProjetos(portas).importarRepo(corpoImportar);

    expect(resposta.status).toBe(409);
    expect(enfileirados).toEqual([]);
  });

  it("recusa com 409 um projeto incompleto, com as pendências na mensagem", async () => {
    const { portas, enfileirados } = portasFalsas({ pendenciasBloqueantes: () => ["falta o PO"] });

    const resposta = await createProjetos(portas).importarRepo(corpoImportar);

    expect(resposta.status).toBe(409);
    expect(resposta.body).toMatchObject({ error: expect.stringContaining("falta o PO") });
    expect(enfileirados).toEqual([]);
  });

  it("recusa com 409 um repositório desplugado", async () => {
    const { portas, estado, enfileirados } = portasFalsas();
    estadoDe(estado).repos = { novo: { repo: "dono/novo", status: "desativado" } };

    const resposta = await createProjetos(portas).importarRepo(corpoImportar);

    expect(resposta.status).toBe(409);
    expect(enfileirados).toEqual([]);
  });

  it("aceita com 202, grava o registro 'importando' e enfileira uma única vez", async () => {
    const { portas, estado, enfileirados } = portasFalsas();

    const resposta = await createProjetos(portas).importarRepo(corpoImportar);

    expect(resposta.status).toBe(202);
    expect(estadoDe(estado).importacoes?.["42"]).toMatchObject({ status: "importando", repo: "dono/novo" });
    expect(enfileirados).toEqual([42]);
  });

  it("uma importação já em andamento responde o registro atual e não enfileira de novo", async () => {
    const { portas, estado, enfileirados } = portasFalsas();
    estadoDe(estado).importacoes = { "42": { status: "importando" } };

    const resposta = await createProjetos(portas).importarRepo(corpoImportar);

    expect(resposta.status).toBe(202);
    expect(enfileirados).toEqual([]);
  });
});

describe("módulo de Projetos: plugar e desplugar repositório", () => {
  it("plugar: recusa com 404 quando nenhum projeto monitora o repositório", async () => {
    const { portas } = portasFalsas({ projetoDoRepositorio: () => undefined });

    const resposta = await createProjetos(portas).plugarRepo("dono/novo");

    expect(resposta.status).toBe(404);
  });

  it("plugar: reativa o repositório do projeto", async () => {
    const { portas, estado } = portasFalsas();
    estadoDe(estado).repos = { novo: { repo: "dono/novo", status: "desativado" } };

    const resposta = await createProjetos(portas).plugarRepo("dono/novo");

    expect(resposta.status).toBe(200);
    expect(estadoDe(estado).repos?.novo.status).toBe("ativo");
  });

  it("desplugar: recusa com 404 quando nenhum projeto monitora o repositório", async () => {
    const { portas } = portasFalsas({ projetoDoRepositorio: () => undefined });

    const resposta = await createProjetos(portas).desplugarRepo("dono/novo", false);

    expect(resposta.status).toBe(404);
  });

  it("desplugar: com Tarefa ativa e sem force, responde 409 e não muda o estado", async () => {
    const { portas, estado } = portasFalsas();
    estadoDe(estado).tasks = [{ id: "novo/PROJ-1", project: "novo", status: "ativa", durableId: "d1" }];

    const resposta = await createProjetos(portas).desplugarRepo("dono/novo", false);

    expect(resposta.status).toBe(409);
    expect(resposta.body).toMatchObject({ tarefasAtivas: ["novo/PROJ-1"] });
    expect(estadoDe(estado).repos).toBeUndefined();
  });

  it("desplugar com force: desativa, cancela a Tarefa ativa e executa os efeitos", async () => {
    const { portas, estado, executados } = portasFalsas();
    estadoDe(estado).tasks = [{ id: "novo/PROJ-1", project: "novo", status: "ativa", durableId: "d1" }];

    const resposta = await createProjetos(portas).desplugarRepo("dono/novo", true);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ ok: true, status: "desativado", tarefasCanceladas: ["novo/PROJ-1"] });
    expect(estadoDe(estado).repos?.novo.status).toBe("desativado");
    expect(executados).toEqual([{ type: "abortar", id: "novo/PROJ-1" }]);
  });
});

/** Configuração sem pendências: repositório com comando de teste, PO, tech lead e provedor permitido. */
const configCompleta = (nome: string) =>
  ProjectConfig.parse({
    ...referencia,
    name: nome,
    people: [
      { id: "po-1", role: "po" },
      { id: "tl-1", role: "tech_lead" },
    ],
    repositories: [{ path: `/dados/repositorios/${nome}`, prefix: "NV", test: { command: ["npm", "test"] } }],
    allowedProviders: ["openai"],
  });

describe("módulo de Projetos: pausar e retomar", () => {
  it("pausar: recusa com 404 um projeto que não existe", async () => {
    const { portas } = portasFalsas();

    const resposta = await createProjetos(portas).pausar("novo");

    expect(resposta.status).toBe(404);
  });

  it("pausar: recusa com 409 um projeto incompleto, sem pausar", async () => {
    const { portas, estado } = portasFalsas();
    estadoDe(estado).projetos = { novo: JSON.stringify({ ...referencia, name: "novo" }) };

    const resposta = await createProjetos(portas).pausar("novo");

    expect(resposta.status).toBe(409);
    expect((estado as unknown as { projetosPausados?: string[] }).projetosPausados).toBeUndefined();
  });

  it("pausar: um projeto ativo fica pausado", async () => {
    const { portas, estado } = portasFalsas();
    estadoDe(estado).projetos = { novo: JSON.stringify(configCompleta("novo")) };

    const resposta = await createProjetos(portas).pausar("novo");

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ estado: "pausado" });
    expect((estado as unknown as { projetosPausados: string[] }).projetosPausados).toEqual(["novo"]);
  });

  it("retomar: volta a fila as Tarefas paradas só pela pausa, e não as pausadas pelo usuário", async () => {
    const { portas, estado } = portasFalsas();
    estadoDe(estado).projetos = { novo: JSON.stringify(configCompleta("novo")) };
    (estado as unknown as { projetosPausados: string[] }).projetosPausados = ["novo"];
    estadoDe(estado).tasks = [
      { id: "novo/P-1", project: "novo", status: "pausada", pauseRequested: false },
      { id: "novo/P-2", project: "novo", status: "pausada", pauseRequested: true },
    ];

    const resposta = await createProjetos(portas).retomar("novo");

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ estado: "ativo" });
    const tarefas = (estado as unknown as { tasks: { id: string; status: string }[] }).tasks;
    expect(tarefas.map((t) => [t.id, t.status])).toEqual([
      ["novo/P-1", "enfileirada"],
      ["novo/P-2", "pausada"],
    ]);
  });
});

describe("módulo de Projetos: remover projeto", () => {
  it("recusa com 404 um projeto que não existe", async () => {
    const { portas } = portasFalsas();

    const resposta = await createProjetos(portas).remover("novo", "novo");

    expect(resposta.status).toBe(404);
  });

  it("recusa com 400 sem a confirmação do nome, sem remover", async () => {
    const { portas, estado } = portasFalsas();
    estadoDe(estado).projetos = { novo: JSON.stringify(configCompleta("novo")) };

    const resposta = await createProjetos(portas).remover("novo", "outro");

    expect(resposta.status).toBe(400);
    expect(Object.keys(estadoDe(estado).projetos ?? {})).toEqual(["novo"]);
  });

  it("recusa com 409 com Tarefa em andamento, sem remover", async () => {
    const { portas, estado } = portasFalsas();
    estadoDe(estado).projetos = { novo: JSON.stringify(configCompleta("novo")) };
    estadoDe(estado).tasks = [{ id: "novo/P-1", project: "novo", status: "ativa" }];

    const resposta = await createProjetos(portas).remover("novo", "novo");

    expect(resposta.status).toBe(409);
    expect(resposta.body).toMatchObject({ tarefasEmAndamento: ["novo/P-1"] });
    expect(Object.keys(estadoDe(estado).projetos ?? {})).toEqual(["novo"]);
  });

  it("remove: tira o projeto do estado, reserva o nome, registra o histórico e esquece-o do processo", async () => {
    const esquecidos: string[] = [];
    const { portas, estado } = portasFalsas({ fabrica: { esquecer: (nome) => void esquecidos.push(nome) } });
    estadoDe(estado).projetos = { novo: JSON.stringify(configCompleta("novo")) };
    estadoDe(estado).repos = { novo: { repo: "dono/novo", status: "ativo" } };

    const resposta = await createProjetos(portas).remover("novo", "novo");

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ removido: "novo", prefixoReservado: null });
    const gravado = estado as unknown as {
      projetos: Record<string, string>;
      repos: Record<string, unknown>;
      projetosRemovidos: Record<string, unknown>;
      historicoConfig: Record<string, { campos: string[] }[]>;
    };
    expect(gravado.projetos).toEqual({});
    expect(gravado.repos).toEqual({});
    expect(Object.keys(gravado.projetosRemovidos)).toEqual(["novo"]);
    expect(gravado.historicoConfig.novo.at(-1)?.campos).toEqual(["projeto removido"]);
    expect(esquecidos).toEqual(["novo"]);
  });
});
