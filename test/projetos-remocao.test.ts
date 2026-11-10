import { mkdir } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { api, poll, startTestFactory, type TestFactory, USER } from "./harness.js";

const BASE = "https://jira.example.invalid";
const EMAIL = "igor@example.invalid";
const TOKEN = "token-de-teste-sem-valor-real";

/** Fetch falso da conexão com o Jira: aceita a credencial, para a Fonte de teste ficar válida. */
const fetchFonte = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

/** GitLab falso para criar um projeto novo: o token `glpat-ok` vê `grupo/projeto`. */
const fetchGitlab = (async (url: string, init?: RequestInit) => {
  const alvo = new URL(url);
  const token = new Headers(init?.headers).get("PRIVATE-TOKEN");
  if (token === "glpat-ok" && alvo.pathname === "/api/v4/projects/grupo%2Fprojeto") {
    return new Response(JSON.stringify({ path_with_namespace: "grupo/projeto" }), { status: 200 });
  }
  if (token === "glpat-ok" && alvo.pathname === "/api/v4/projects/grupo%2Fprojeto/members/all") {
    return new Response("[]", { status: 200 });
  }
  return new Response('{"message":"404 Project Not Found"}', { status: 404 });
}) as unknown as typeof fetch;
const clonarGitlab = async (opts: { destino: string }) => {
  await mkdir(opts.destino, { recursive: true });
};

type Config = Record<string, unknown> & {
  source: Record<string, unknown>;
  repositories: { path: string; prefix: string; test: { command: string[] } }[];
};

const PO = { id: "po-x", role: "po" };
const TECH_LEAD = { id: "tl-x", role: "tech_lead" };

/** Sobe a fábrica com o projeto `exemplo` ativo (Fonte Jira com prefixo PROJ), e os cards informados. */
async function subirAtivo(cards = [{ key: "PROJ-1", title: "Primeira", status: "A Fazer", assignee: USER }]) {
  const f = await startTestFactory({ fetchFonte, fetchGitlab, clonarRepositorioGitlab: clonarGitlab, cards });
  await api(f, "PUT", "/segredos/jira-token", { valor: TOKEN });
  await api(f, "PUT", "/segredos/gitlab-token", { valor: "glpat-ok" });
  const atual = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");
  await api(f, "PUT", "/projetos/exemplo/configuracao", {
    ...atual,
    source: { type: "jira", project: "PROJ", assignee: USER, baseUrl: BASE, email: EMAIL, credential: "jira-token" },
    repositories: [{ path: process.cwd(), prefix: "EX", test: { command: ["npm", "test"] } }],
    people: [PO, TECH_LEAD, { id: USER }],
  });
  // A troca de Fonte deixa o projeto incompleto até a confirmação (ticket 10).
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

/** Criação de projeto GitLab com o nome e o prefixo (chave da Fonte) informados. */
const criarGitlab = (f: TestFactory, nome: string, prefixo: string) =>
  chamada(f, "POST", "/projetos/gitlab", {
    nome,
    caminho: "grupo/projeto",
    servidor: "",
    fonte: { project: prefixo, assignee: "fulano", credential: "gitlab-token" },
    comandoTeste: ["npm", "test"],
  });

const statusDaTarefa = async (f: TestFactory, id: string) =>
  (await api<{ id: string; status: string }[]>(f, "GET", "/tasks")).find((t) => t.id === id)?.status;

describe("remoção de projeto (ticket 11)", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("remoção sem confirmação explícita é recusada e nada muda", async () => {
    f = await subirAtivo();
    const antes = await api(f, "GET", "/projetos/exemplo/configuracao");

    const semCorpo = await chamada(f, "POST", "/projetos/exemplo/remocao");
    expect(semCorpo.status).toBe(415);

    const confirmacaoErrada = await chamada(f, "POST", "/projetos/exemplo/remocao", { confirmar: "outro" });
    expect(confirmacaoErrada.status).toBe(400);
    expect(String(confirmacaoErrada.body?.error)).toContain("confirme a remoção");

    expect(await api(f, "GET", "/projetos/exemplo/configuracao")).toEqual(antes);
  });

  it("remoção com tarefa em andamento é recusada com a causa, e a tarefa segue", async () => {
    f = await subirAtivo();
    await poll(f);
    expect(["ativa", "aguardando-humano"]).toContain(await statusDaTarefa(f, "exemplo/PROJ-1"));

    const res = await chamada(f, "POST", "/projetos/exemplo/remocao", { confirmar: "exemplo" });

    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("há tarefas em andamento no projeto exemplo");
    expect(res.body?.tarefasEmAndamento).toEqual(["exemplo/PROJ-1"]);
    expect((await chamada(f, "GET", "/projetos/exemplo/configuracao")).status).toBe(200);
    expect(await statusDaTarefa(f, "exemplo/PROJ-1")).not.toBeUndefined();
  });

  it("sem tarefa em andamento, a remoção apaga a configuração e sai da lista de projetos", async () => {
    f = await subirAtivo();

    const res = await chamada(f, "POST", "/projetos/exemplo/remocao", { confirmar: "exemplo" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removido: "exemplo", prefixoReservado: null });
    expect((await chamada(f, "GET", "/projetos/exemplo/configuracao")).status).toBe(404);
    expect((await chamada(f, "GET", "/projetos/exemplo/estado")).status).toBe(404);
    expect((await api<{ nome: string }[]>(f, "GET", "/projetos")).map((p) => p.nome)).not.toContain("exemplo");
  });

  it("o histórico das tarefas concluídas (ou canceladas) fica depois da remoção", async () => {
    f = await subirAtivo();
    await poll(f);
    await api(f, "POST", "/tasks/exemplo/PROJ-1/cancel");
    expect(await statusDaTarefa(f, "exemplo/PROJ-1")).toBe("cancelada");

    const res = await chamada(f, "POST", "/projetos/exemplo/remocao", { confirmar: "exemplo" });

    expect(res.status).toBe(200);
    expect(await statusDaTarefa(f, "exemplo/PROJ-1")).toBe("cancelada");
  });

  it("com histórico, o prefixo segue reservado: um projeto novo com o mesmo prefixo é recusado", async () => {
    f = await subirAtivo();
    await poll(f);
    await api(f, "POST", "/tasks/exemplo/PROJ-1/cancel");
    const removido = await chamada(f, "POST", "/projetos/exemplo/remocao", { confirmar: "exemplo" });
    expect(removido.body).toEqual({ removido: "exemplo", prefixoReservado: "PROJ" });

    const mesmoPrefixo = await criarGitlab(f, "novo", "proj");

    expect(mesmoPrefixo.status).toBe(409);
    expect(String(mesmoPrefixo.body?.error)).toContain("o prefixo PROJ está reservado pelo projeto removido exemplo");
  });

  it("o nome do projeto removido não volta a ser usado, mesmo sem histórico", async () => {
    f = await subirAtivo();
    await chamada(f, "POST", "/projetos/exemplo/remocao", { confirmar: "exemplo" });

    const reuso = await criarGitlab(f, "exemplo", "OUTRO");

    expect(reuso.status).toBe(409);
    expect(String(reuso.body?.error)).toContain("pertence a um projeto removido");
  });

  it("sem histórico, o prefixo do projeto removido volta a estar livre", async () => {
    f = await subirAtivo();
    const removido = await chamada(f, "POST", "/projetos/exemplo/remocao", { confirmar: "exemplo" });
    expect(removido.body).toEqual({ removido: "exemplo", prefixoReservado: null });

    const novo = await criarGitlab(f, "novo", "PROJ");

    expect(novo.status).toBe(201);
  });

  it("o projeto do YAML removido não volta depois do reinício do daemon", async () => {
    f = await subirAtivo();
    await chamada(f, "POST", "/projetos/exemplo/remocao", { confirmar: "exemplo" });

    f = await f.restart();

    expect((await chamada(f, "GET", "/projetos/exemplo/configuracao")).status).toBe(404);
    expect((await api<{ nome: string }[]>(f, "GET", "/projetos")).map((p) => p.nome)).not.toContain("exemplo");
  });
});
