import { afterEach, describe, expect, it } from "vitest";
import { api, poll, startTestFactory, type TestFactory, USER } from "./harness.js";

const BASE = "https://jira.example.invalid";
const EMAIL = "igor@example.invalid";
const TOKEN = "token-de-teste-sem-valor-real";

/** Fetch falso da conexão com o Jira: aceita a credencial, para a Fonte de teste ficar válida. */
const fetchFonte = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

type Config = Record<string, unknown> & {
  source: Record<string, unknown>;
  repositories: { path: string; prefix: string; test: { command: string[] } }[];
  dryRun: boolean;
};

const PO = { id: "po-x", role: "po" };
const TECH_LEAD = { id: "tl-x", role: "tech_lead" };

/** Sobe a fábrica com um projeto ativo, Fonte Jira com credencial e os cards informados. */
async function subirAtivo(cards = [{ key: "PROJ-1", title: "Primeira", status: "A Fazer", assignee: USER }]) {
  const f = await startTestFactory({ fetchFonte, cards });
  await api(f, "PUT", "/segredos/jira-token", { valor: TOKEN });
  const atual = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");
  await api(f, "PUT", "/projetos/exemplo/configuracao", {
    ...atual,
    source: { type: "jira", project: "PROJ", assignee: USER, baseUrl: BASE, email: EMAIL, credential: "jira-token" },
    repositories: [{ path: process.cwd(), prefix: "EX", test: { command: ["npm", "test"] } }],
    people: [PO, TECH_LEAD, { id: USER }],
  });
  // Trocas feitas na montagem do teste são confirmadas antes de começar (ticket 10).
  await api(f, "POST", "/projetos/exemplo/confirmacao");
  return f;
}

/** Chamada que devolve o status mesmo fora do 2xx. */
async function chamada(f: TestFactory, method: string, path: string, body?: unknown) {
  const res = await fetch(`${f.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

const estadoDe = (f: TestFactory) =>
  api<{ estado: string; pendencias: string[]; aguardandoConfirmacao: boolean }>(f, "GET", "/projetos/exemplo/estado");
const statusDaTarefa = async (f: TestFactory, id: string) =>
  (await api<{ id: string; status: string }[]>(f, "GET", "/tasks")).find((t) => t.id === id)?.status;

describe("troca de Fonte ou repositório (ticket 10)", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("trocar a Fonte com tarefa em andamento é recusado com a causa, e a configuração não muda", async () => {
    f = await subirAtivo();
    await poll(f);
    expect(["ativa", "aguardando-humano"]).toContain(await statusDaTarefa(f, "exemplo/PROJ-1"));
    const antes = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await chamada(f, "PUT", "/projetos/exemplo/configuracao", {
      ...antes,
      source: { ...antes.source, project: "OUTRO" },
    });

    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("há tarefas em andamento no projeto exemplo");
    expect(res.body?.tarefasEmAndamento).toEqual(["exemplo/PROJ-1"]);
    expect(await api(f, "GET", "/projetos/exemplo/configuracao")).toEqual(antes);
    expect((await estadoDe(f)).aguardandoConfirmacao).toBe(false);
  });

  it("trocar o repositório com tarefa em andamento também é recusado", async () => {
    f = await subirAtivo();
    await poll(f);
    const antes = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await chamada(f, "PUT", "/projetos/exemplo/configuracao", {
      ...antes,
      repositories: [{ ...antes.repositories[0], prefix: "NOVO" }],
    });

    expect(res.status).toBe(409);
    expect(await api(f, "GET", "/projetos/exemplo/configuracao")).toEqual(antes);
  });

  it("sem tarefa em andamento, a troca é gravada e o projeto fica incompleto até a confirmação", async () => {
    f = await subirAtivo();
    const antes = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");

    const troca = await chamada(f, "PUT", "/projetos/exemplo/configuracao", {
      ...antes,
      source: { ...antes.source, project: "OUTRO" },
    });

    expect(troca.status).toBe(200);
    expect((await api<Config>(f, "GET", "/projetos/exemplo/configuracao")).source.project).toBe("OUTRO");
    expect(await estadoDe(f)).toEqual({
      estado: "incompleto",
      pendencias: ["confirme a nova Fonte ou repositório"],
      aguardandoConfirmacao: true,
    });

    const confirmacao = await chamada(f, "POST", "/projetos/exemplo/confirmacao");
    expect(confirmacao.status).toBe(200);
    expect(await estadoDe(f)).toEqual({ estado: "ativo", pendencias: [], aguardandoConfirmacao: false });
  });

  it("a troca de repositório também deixa o projeto incompleto até a confirmação", async () => {
    f = await subirAtivo();
    const antes = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");

    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...antes,
      repositories: [{ ...antes.repositories[0], prefix: "NOVO" }],
    });

    expect((await estadoDe(f)).estado).toBe("incompleto");
    expect((await estadoDe(f)).aguardandoConfirmacao).toBe(true);
  });

  it("enquanto aguarda confirmação, a troca não deixa o projeto buscar nem começar Tarefa", async () => {
    f = await subirAtivo();
    const antes = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");
    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...antes,
      source: { ...antes.source, project: "OUTRO" },
    });

    await poll(f);

    expect(await statusDaTarefa(f, "exemplo/PROJ-1")).toBeUndefined();
  });

  it("tarefa cancelada não bloqueia a troca: só tarefa ainda não terminada conta", async () => {
    f = await subirAtivo();
    await poll(f);
    await api(f, "POST", "/tasks/exemplo/PROJ-1/cancel");
    const antes = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await chamada(f, "PUT", "/projetos/exemplo/configuracao", {
      ...antes,
      source: { ...antes.source, project: "OUTRO" },
    });

    expect(res.status).toBe(200);
  });

  it("mudar o comando de teste do repositório não é troca: passa mesmo com tarefa em andamento", async () => {
    f = await subirAtivo();
    await poll(f);
    const antes = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await chamada(f, "PUT", "/projetos/exemplo/configuracao", {
      ...antes,
      repositories: [{ ...antes.repositories[0], test: { command: ["npm", "run", "test:unit"] } }],
    });

    expect(res.status).toBe(200);
    expect((await estadoDe(f)).aguardandoConfirmacao).toBe(false);
  });

  it("mudar o ensaio não é troca de Fonte: não exige confirmação nem é barrado por tarefa em andamento", async () => {
    f = await subirAtivo();
    await poll(f);
    const antes = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await chamada(f, "PUT", "/projetos/exemplo/configuracao", { ...antes, dryRun: true });

    expect(res.status).toBe(200);
    expect(await estadoDe(f)).toEqual({ estado: "ativo", pendencias: [], aguardandoConfirmacao: false });
  });

  it("confirmar com a configuração incompleta por outro motivo deixa o projeto incompleto com a causa", async () => {
    f = await subirAtivo();
    const antes = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");
    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...antes,
      source: { ...antes.source, project: "OUTRO" },
      people: [TECH_LEAD],
    });

    await chamada(f, "POST", "/projetos/exemplo/confirmacao");

    expect(await estadoDe(f)).toEqual({
      estado: "incompleto",
      pendencias: ["falta uma pessoa no perfil PO"],
      aguardandoConfirmacao: false,
    });
  });
});
