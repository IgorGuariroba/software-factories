import { describe, expect, it } from "vitest";
import { ProjectConfig } from "../src/config.js";
import {
  criarConfiguracaoProjetos,
  type EstadoConfiguracao,
  type PortasConfiguracaoProjeto,
} from "../src/packages/configuracao-projeto/index.js";

// Configuração de projetos com portas falsas: fixa a validação ao salvar, a troca de Fonte só sem Tarefas em andamento,
// a confirmação pendente, o histórico de campos alterados e a aplicação aos projetos. Sem disco, sem Fonte, sem fábrica.

const base = {
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
  people: [
    { id: "po-1", role: "po" },
    { id: "tl-1", role: "tech_lead" },
  ],
  repositories: [{ path: "/dados/sf", prefix: "NV", test: { command: ["npm", "test"] } }],
  allowedProviders: ["openai"],
};

const configuracao = (extra: Record<string, unknown> = {}) => ProjectConfig.parse({ ...base, ...extra });

function portasFalsas(estado: EstadoConfiguracao, sobrescritas: Partial<PortasConfiguracaoProjeto> = {}) {
  const aplicadas: unknown[] = [];
  const portas: PortasConfiguracaoProjeto = {
    estado: async () => estado,
    alterar: async (fn) => fn(estado),
    agora: () => Date.UTC(2026, 0, 2),
    tarefasEmAndamento: () => [],
    ehDiretorio: async () => true,
    erroDaFonte: async () => undefined,
    aplicar: (config) => {
      aplicadas.push(config);
    },
    ...sobrescritas,
  };
  return { cfg: criarConfiguracaoProjetos(portas), aplicadas, portas };
}

const comProjeto = (c: ProjectConfig, extra: Partial<EstadoConfiguracao> = {}): EstadoConfiguracao => ({
  projetos: { sf: JSON.stringify(c) },
  ...extra,
});

describe("Configuração: leitura", () => {
  it("projeto inexistente responde 404 em toda leitura", async () => {
    const { cfg } = portasFalsas({});
    for (const r of [
      await cfg.configuracao("x"),
      await cfg.estado("x"),
      await cfg.pendencias("x"),
      await cfg.historico("x"),
    ])
      expect(r.status).toBe(404);
  });

  it("configuração completa não tem pendências e está ativa", async () => {
    const { cfg } = portasFalsas(comProjeto(configuracao()));
    expect(await cfg.pendencias("sf")).toEqual({ status: 200, body: [] });
    expect(await cfg.estado("sf")).toMatchObject({
      status: 200,
      body: { estado: "ativo", aguardandoConfirmacao: false },
    });
  });

  it("projeto pausado aparece como pausado", async () => {
    const { cfg } = portasFalsas(comProjeto(configuracao(), { projetosPausados: ["sf"] }));
    expect(await cfg.estado("sf")).toMatchObject({ body: { estado: "pausado" } });
  });

  it("histórico de projeto removido continua consultável", async () => {
    const historico = [{ quando: "2026-01-01T00:00:00.000Z", autor: "usuario", campos: ["nome"] }];
    const { cfg } = portasFalsas({ projetosRemovidos: { sf: {} }, historicoConfig: { sf: historico } });
    expect(await cfg.historico("sf")).toEqual({ status: 200, body: historico });
  });
});

describe("Configuração: confirmação da Fonte", () => {
  it("troca em aberto aparece como pendência até ser confirmada", async () => {
    const estado = comProjeto(configuracao(), { projetosAguardandoConfirmacao: ["sf"] });
    const { cfg } = portasFalsas(estado);
    const antes = await cfg.pendencias("sf");
    expect(antes.body).toEqual(["confirme a nova Fonte ou repositório"]);
    const confirmado = await cfg.confirmarFonte("sf");
    expect(confirmado).toMatchObject({ status: 200, body: { aguardandoConfirmacao: false, pendencias: [] } });
    expect(estado.projetosAguardandoConfirmacao).toEqual([]);
  });
});

describe("Configuração: salvar", () => {
  it("corpo inválido responde 400 com os erros do esquema", async () => {
    const { cfg } = portasFalsas(comProjeto(configuracao()));
    const r = await cfg.salvar("sf", { name: "sf" });
    expect(r.status).toBe(400);
  });

  it("nome do corpo diferente da URL responde 400", async () => {
    const { cfg } = portasFalsas(comProjeto(configuracao()));
    expect(await cfg.salvar("outro", configuracao())).toEqual({
      status: 400,
      body: { error: "o nome do projeto no corpo não bate com a URL" },
    });
  });

  it("caminho de repositório inexistente responde 400", async () => {
    const { cfg } = portasFalsas(comProjeto(configuracao()), { ehDiretorio: async () => false });
    const r = await cfg.salvar("sf", configuracao());
    expect(r).toEqual({ status: 400, body: { error: "caminho do repositório não existe: /dados/sf" } });
  });

  it("Fonte com erro do provedor responde 400 com a mensagem dele", async () => {
    const { cfg } = portasFalsas(comProjeto(configuracao()), {
      erroDaFonte: async () => "credencial github não cadastrada",
    });
    expect(await cfg.salvar("sf", configuracao())).toEqual({
      status: 400,
      body: { error: "credencial github não cadastrada" },
    });
  });

  it("alteração comum grava, registra os campos no histórico e aplica", async () => {
    const estado = comProjeto(configuracao());
    const { cfg, aplicadas } = portasFalsas(estado);
    const nova = configuracao({ statuses: { aberta: "backlog", fechada: "done" } });
    const r = await cfg.salvar("sf", nova);
    expect(r.status).toBe(200);
    expect(JSON.parse(estado.projetos?.sf ?? "{}")).toMatchObject({ statuses: { aberta: "backlog" } });
    expect(estado.historicoConfig?.sf).toEqual([
      expect.objectContaining({ autor: "usuario", campos: expect.arrayContaining(["statuses"]) }),
    ]);
    expect(aplicadas).toHaveLength(1);
  });

  it("trocar a Fonte com tarefas em andamento responde 409, não grava e não aplica", async () => {
    const estado = comProjeto(configuracao());
    const antes = estado.projetos?.sf;
    const { cfg, aplicadas } = portasFalsas(estado, { tarefasEmAndamento: () => ["sf/K-1"] });
    const nova = configuracao({ source: { ...base.source, repo: "dono/outro" } });
    const r = await cfg.salvar("sf", nova);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ tarefasEmAndamento: ["sf/K-1"] });
    expect(estado.projetos?.sf).toBe(antes);
    expect(aplicadas).toEqual([]);
  });

  it("trocar a Fonte sem tarefas em andamento grava e deixa o projeto aguardando confirmação", async () => {
    const estado = comProjeto(configuracao());
    const { cfg } = portasFalsas(estado);
    const nova = configuracao({ source: { ...base.source, repo: "dono/outro" } });
    expect((await cfg.salvar("sf", nova)).status).toBe(200);
    expect(estado.projetosAguardandoConfirmacao).toEqual(["sf"]);
  });

  it("projeto que não existe responde 404 e nada é aplicado", async () => {
    const { cfg, aplicadas } = portasFalsas({});
    expect((await cfg.salvar("sf", configuracao())).status).toBe(404);
    expect(aplicadas).toEqual([]);
  });
});
