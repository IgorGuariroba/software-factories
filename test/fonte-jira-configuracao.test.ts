import { afterEach, describe, expect, it } from "vitest";
import { api, poll, startTestFactory, type TestFactory } from "./harness.js";

const BASE = "https://jira.example.invalid";
const EMAIL = "igor@example.invalid";
const TOKEN = "token-de-teste-sem-valor-real";

type Config = {
  source: { type: string; project: string; assignee: string; baseUrl?: string; email?: string; credential?: string };
};

/** Fetch falso da checagem de conexão com o Jira: aceita só a credencial certa (Basic de e-mail e token). */
function jiraFake(aceitar: boolean) {
  const chamadas: { url: string; auth: string | null }[] = [];
  const fetchFake = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    chamadas.push({ url, auth });
    const esperado = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`;
    const ok = aceitar && url === `${BASE}/rest/api/3/myself` && auth === esperado;
    return new Response(ok ? "{}" : "", { status: ok ? 200 : 401 });
  };
  return { fetchFake, chamadas };
}

describe("fonte Jira editável pela interface, com credencial no cofre (fatia 03)", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("grava a credencial no cofre e lista só o nome, sem o valor", async () => {
    f = await startTestFactory({});

    const gravado = await api<{ nome: string; atualizadoEm: string }>(f, "PUT", "/segredos/jira-token", {
      valor: TOKEN,
    });
    const listados = await api<{ nome: string }[]>(f, "GET", "/segredos");

    expect(gravado.nome).toBe("jira-token");
    expect(listados.map((s) => s.nome)).toEqual(["jira-token"]);
    expect(JSON.stringify(listados)).not.toContain(TOKEN);
  });

  it("recusa uma Fonte Jira que aponta para credencial não cadastrada", async () => {
    f = await startTestFactory({});
    const atual = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await fetch(`${f.url}/projetos/exemplo/configuracao`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...atual,
        source: { ...atual.source, baseUrl: BASE, email: EMAIL, credential: "jira-token" },
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("credencial jira-token não cadastrada");
  });

  it("não salva a Fonte quando a conexão com o Jira falha, e não ecoa o token", async () => {
    const { fetchFake } = jiraFake(false);
    f = await startTestFactory({ fetchFonte: fetchFake });
    await api(f, "PUT", "/segredos/jira-token", { valor: TOKEN });
    const antes = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await fetch(`${f.url}/projetos/exemplo/configuracao`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...antes,
        source: { ...antes.source, baseUrl: BASE, email: EMAIL, credential: "jira-token" },
      }),
    });
    const corpo = await res.text();

    expect(res.status).toBe(400);
    expect(corpo).toContain("conexão com o Jira falhou");
    expect(corpo).not.toContain(TOKEN);
    const depois = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");
    expect(depois.source.baseUrl).toBeUndefined();
  });

  it("trocar a credencial em uso recusa um valor que não conecta, sem gravá-lo nem registrar a troca", async () => {
    const { fetchFake } = jiraFake(true);
    f = await startTestFactory({ fetchFonte: fetchFake });
    await api(f, "PUT", "/segredos/jira-token", { valor: TOKEN });
    const atual = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");
    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...atual,
      source: { ...atual.source, baseUrl: BASE, email: EMAIL, credential: "jira-token" },
    });

    const res = await fetch(`${f.url}/segredos/jira-token`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ valor: "valor-que-nao-conecta" }),
    });
    const corpo = await res.text();

    expect(res.status).toBe(400);
    expect(corpo).toContain("a credencial jira-token não foi trocada");
    expect(corpo).not.toContain("valor-que-nao-conecta");
    const historico = await api<{ campos: string[] }[]>(f, "GET", "/projetos/exemplo/historico");
    expect(historico.some((h) => h.campos.includes("credencial jira-token trocada"))).toBe(false);
  });

  it("trocar a credencial em uso com um valor válido grava e registra a troca no histórico do projeto", async () => {
    const { fetchFake } = jiraFake(true);
    f = await startTestFactory({ fetchFonte: fetchFake });
    await api(f, "PUT", "/segredos/jira-token", { valor: TOKEN });
    const atual = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");
    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...atual,
      source: { ...atual.source, baseUrl: BASE, email: EMAIL, credential: "jira-token" },
    });

    await api(f, "PUT", "/segredos/jira-token", { valor: TOKEN });

    const historico = await api<{ campos: string[] }[]>(f, "GET", "/projetos/exemplo/historico");
    expect(historico.some((h) => h.campos.includes("credencial jira-token trocada"))).toBe(true);
  });

  it("com credencial válida, testa a conexão e salva a Fonte; a API devolve a configuração nova", async () => {
    const { fetchFake, chamadas } = jiraFake(true);
    f = await startTestFactory({ fetchFonte: fetchFake });
    await api(f, "PUT", "/segredos/jira-token", { valor: TOKEN });
    const atual = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");

    const salvo = await api<Config>(f, "PUT", "/projetos/exemplo/configuracao", {
      ...atual,
      source: { ...atual.source, baseUrl: BASE, email: EMAIL, credential: "jira-token" },
    });

    expect(chamadas.some((c) => c.url === `${BASE}/rest/api/3/myself`)).toBe(true);
    expect(salvo.source.credential).toBe("jira-token");
    const lido = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");
    expect(lido.source.baseUrl).toBe(BASE);
  });

  it("trocar a Fonte não apaga as tarefas já existentes", async () => {
    const { fetchFake } = jiraFake(true);
    f = await startTestFactory({
      fetchFonte: fetchFake,
      cards: [{ key: "PROJ-1", title: "Algo", status: "A Fazer", assignee: "igor" }],
    });
    await api(f, "PUT", "/segredos/jira-token", { valor: TOKEN });
    await poll(f);
    const antes = await api<{ id: string }[]>(f, "GET", "/tasks");
    expect(antes.length).toBeGreaterThan(0);
    const atual = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");

    await api(f, "PUT", "/projetos/exemplo/configuracao", {
      ...atual,
      source: { ...atual.source, baseUrl: BASE, email: EMAIL, credential: "jira-token" },
    });

    const depois = await api<{ id: string }[]>(f, "GET", "/tasks");
    expect(depois.map((t) => t.id)).toEqual(antes.map((t) => t.id));
  });
});
