import { afterEach, describe, expect, it } from "vitest";
import { api, PO as PO_ID, poll, startTestFactory, type TestFactory, USER } from "./harness.js";

const BASE = "https://jira.example.invalid";
const EMAIL = "igor@example.invalid";
const TOKEN = "token-de-teste-sem-valor-real";

/** Fetch falso da conexão com o Jira: aceita a credencial certa, para o projeto de teste ficar ativo. */
const fetchFonte = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

type Config = Record<string, unknown> & {
  dryRun: boolean;
  people: { id: string; role?: string; perfis?: string[] }[];
};

const PO = { id: PO_ID, role: "po" };
const TECH_LEAD = { id: "tl-x", role: "tech_lead" };

/** Sobe a fábrica com um projeto ativo: Fonte Jira com credencial, repositório, PO e tech lead (ADR-0022). */
async function subirAtivo(): Promise<TestFactory> {
  const f = await startTestFactory({
    fetchFonte,
    cards: [
      { key: "PROJ-1", title: "Primeira", status: "A Fazer", assignee: USER },
      { key: "PROJ-2", title: "Segunda", status: "A Fazer", assignee: USER },
    ],
  });
  await api(f, "PUT", "/segredos/jira-token", { valor: TOKEN });
  const atual = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");
  await api(f, "PUT", "/projetos/exemplo/configuracao", {
    ...atual,
    source: { type: "jira", project: "PROJ", assignee: USER, baseUrl: BASE, email: EMAIL, credential: "jira-token" },
    repositories: [{ path: process.cwd(), prefix: "EX", test: { command: ["npm", "test"] } }],
    // O responsável na Fonte também é pessoa do projeto: perguntas técnicas vão para ele (ADR-0022).
    people: [PO, TECH_LEAD, { id: USER }],
  });
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
  api<{ estado: string; pendencias: string[] }>(f, "GET", "/projetos/exemplo/estado");
const statusDaTarefa = async (f: TestFactory, id: string) =>
  (await api<{ id: string; status: string }[]>(f, "GET", "/tasks")).find((t) => t.id === id)?.status;

describe("pausar, retomar e ensaio de projeto (ticket 09)", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("pausar um projeto ativo muda o estado para pausado e não altera a configuração", async () => {
    f = await subirAtivo();
    expect((await estadoDe(f)).estado).toBe("ativo");
    const antes = await api(f, "GET", "/projetos/exemplo/configuracao");

    const pausa = await chamada(f, "POST", "/projetos/exemplo/pausa");

    expect(pausa.status).toBe(200);
    expect(pausa.body).toMatchObject({ estado: "pausado", pendencias: [] });
    expect((await estadoDe(f)).estado).toBe("pausado");
    expect(await api(f, "GET", "/projetos/exemplo/configuracao")).toEqual(antes);
  });

  it("só um projeto ativo pausa: um incompleto é recusado com o que falta", async () => {
    f = await startTestFactory({});

    const res = await chamada(f, "POST", "/projetos/exemplo/pausa");

    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("falta uma pessoa no perfil tech lead");
    expect((await estadoDe(f)).estado).toBe("incompleto");
  });

  it("projeto pausado não começa Tarefa nova, e a retomada a enfileira e a inicia", async () => {
    f = await subirAtivo();
    await chamada(f, "POST", "/projetos/exemplo/pausa");

    await poll(f);
    expect(await statusDaTarefa(f, "exemplo/PROJ-1")).toBeUndefined();

    const retomada = await chamada(f, "POST", "/projetos/exemplo/retomada");
    expect(retomada.status).toBe(200);
    expect(retomada.body).toMatchObject({ estado: "ativo" });
    await poll(f);
    // Começou: saiu da fila e chegou à primeira pergunta do fluxo (aguardando a pessoa).
    expect(["ativa", "aguardando-humano"]).toContain(await statusDaTarefa(f, "exemplo/PROJ-1"));
  });

  it("a retomada revalida a configuração: com pendência, responde 409 e o projeto segue pausado", async () => {
    f = await subirAtivo();
    await chamada(f, "POST", "/projetos/exemplo/pausa");
    const atual = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");
    await api(f, "PUT", "/projetos/exemplo/configuracao", { ...atual, people: [TECH_LEAD] });

    const res = await chamada(f, "POST", "/projetos/exemplo/retomada");

    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("falta uma pessoa no perfil PO");
    expect((await estadoDe(f)).estado).toBe("pausado");
    // Sem o PO, o projeto não está ativo: a pausa só sai quando a configuração voltar a estar completa.
    await api(f, "PUT", "/projetos/exemplo/configuracao", { ...atual, people: [PO, TECH_LEAD] });
    expect((await chamada(f, "POST", "/projetos/exemplo/retomada")).status).toBe(200);
  });

  it("a marca de ensaio liga e desliga em projeto pausado, sem mudar o estado", async () => {
    f = await subirAtivo();
    await chamada(f, "POST", "/projetos/exemplo/pausa");
    const atual = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");
    expect(atual.dryRun).toBe(false);

    await api(f, "PUT", "/projetos/exemplo/configuracao", { ...atual, dryRun: true });

    expect((await api<Config>(f, "GET", "/projetos/exemplo/configuracao")).dryRun).toBe(true);
    expect((await estadoDe(f)).estado).toBe("pausado");
    await api(f, "PUT", "/projetos/exemplo/configuracao", { ...atual, dryRun: false });
    expect((await api<Config>(f, "GET", "/projetos/exemplo/configuracao")).dryRun).toBe(false);
  });

  it("a marca de ensaio liga em projeto ativo e a Tarefa segue sem executar escritas reais", async () => {
    f = await subirAtivo();
    const atual = await api<Config>(f, "GET", "/projetos/exemplo/configuracao");

    await api(f, "PUT", "/projetos/exemplo/configuracao", { ...atual, dryRun: true });

    expect((await estadoDe(f)).estado).toBe("ativo");
    expect((await api<Config>(f, "GET", "/projetos/exemplo/configuracao")).dryRun).toBe(true);
  });

  it("pausar no meio da execução: a resposta da pergunta não reabre a Tarefa enquanto o projeto estiver pausado", async () => {
    f = await subirAtivo();
    await poll(f);
    expect(await statusDaTarefa(f, "exemplo/PROJ-1")).toBe("aguardando-humano");
    await chamada(f, "POST", "/projetos/exemplo/pausa");

    await api(f, "POST", "/tasks/exemplo/PROJ-1/questions/1/answer", { answer: process.cwd() });
    await poll(f);

    // Enquanto pausado, a Tarefa não volta a rodar: segue na fila até a retomada.
    expect(await statusDaTarefa(f, "exemplo/PROJ-1")).toBe("enfileirada");
  });
});
