import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import { parseGitHubDelivery } from "../src/github-webhook.js";
import { api, startTestFactory, type TestFactory } from "./harness.js";

const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** API do GitHub falsa: o App e uma instalação que cobre `IgorGuariroba/software-factories`. */
const githubFalso = (() => {
  const fetchFalso = async (url: string) => {
    const caminho = new URL(url).pathname;
    if (caminho === "/app") return json({ id: 5685212, slug: "fabrica-igor-sf", name: "fabrica-igor-sf" });
    if (caminho === "/app/installations") {
      return json([{ id: 180265101, account: { login: "IgorGuariroba" }, repository_selection: "selected" }]);
    }
    if (caminho === "/app/installations/180265101/access_tokens") return json({ token: "ghs_token_falso" });
    if (caminho === "/repos/IgorGuariroba/software-factories/issues") {
      return json([
        { id: 9001, number: 1, title: "Primeira", body: "", state: "open", labels: [] },
        { id: 9002, number: 2, title: "Segunda", body: "- [ ] a", state: "open", labels: [] },
        { id: 9003, number: 3, title: "Um PR", body: "", state: "open", labels: [], pull_request: {} },
      ]);
    }
    if (caminho === "/installation/repositories") {
      return json({
        repositories: [
          { id: 42, full_name: "IgorGuariroba/software-factories", private: false, owner: { login: "IgorGuariroba" } },
        ],
      });
    }
    return json({ message: "Not Found" }, 404);
  };
  return fetchFalso as unknown as typeof fetch;
})();

const githubConfig = (repo: string): Partial<ProjectConfig> => ({
  source: {
    type: "github",
    project: "SF",
    repo,
    assignee: "igor",
    triageApproval: false,
    maxActive: 1,
    ignoreLabels: [],
  } as ProjectConfig["source"],
});

let factory: TestFactory | undefined;

/** Chamada que devolve o status mesmo fora do 2xx (409, 404, 400). */
async function chamada(f: TestFactory, method: string, path: string, body?: unknown) {
  const res = await fetch(`${f.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
}

/** Espera a fila de importação terminar: a leitura roda em segundo plano, então o teste consulta o registro. */
type RegistroImportacao = {
  status: string;
  ultimoErro?: string;
  ultimoResultado?: { criadas: number; vinculadas: number; atualizadas: number; ignoradas: number };
};

async function esperarImportacao(f: TestFactory, repoId: number): Promise<RegistroImportacao> {
  for (let i = 0; i < 200; i++) {
    const catalogo = await api<{ repos: { id: number; importacao: RegistroImportacao | null }[] }>(
      f,
      "GET",
      "/github/repos",
    );
    const registro = catalogo.repos.find((r) => r.id === repoId)?.importacao;
    if (registro && registro.status !== "importando") return registro;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("importação não terminou a tempo");
}
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

type Painel = {
  receptor: { ligado: boolean; porta: number | null; ultimaEntregaEm: string | null };
  app: { configurado: boolean; erro?: string; instalacoes: { conta: string; repositorios: string[] }[] };
  repositorios: { repo: string; status: string; coberto: boolean | null }[];
};

async function chaveNoDisco(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fabrica-chave-"));
  const caminho = join(dir, "app.private-key.pem");
  await writeFile(caminho, PEM, { mode: 0o600 });
  return caminho;
}

describe("GET /github-app: o painel do App em Configurações", () => {
  it("sem App configurado, diz isso e não afirma cobertura", async () => {
    factory = await startTestFactory({ config: githubConfig("dono/repo") });
    const painel = await api<Painel>(factory, "GET", "/github-app");
    expect(painel.app.configurado).toBe(false);
    expect(painel.receptor).toMatchObject({ ligado: false, porta: null, ultimaEntregaEm: null });
    expect(painel.repositorios).toEqual([
      expect.objectContaining({ repo: "dono/repo", status: "ativo", coberto: null }),
    ]);
  });

  it("com o App configurado, mostra as instalações e marca a cobertura de cada repositório plugado", async () => {
    factory = await startTestFactory({
      config: githubConfig("IgorGuariroba/software-factories"),
      githubApp: { appId: 5685212, privateKeyPath: await chaveNoDisco(), fetch: githubFalso },
    });
    const painel = await api<Painel>(factory, "GET", "/github-app");
    expect(painel.app).toMatchObject({
      configurado: true,
      instalacoes: [{ conta: "IgorGuariroba", repositorios: ["IgorGuariroba/software-factories"] }],
    });
    expect(painel.repositorios).toEqual([
      expect.objectContaining({ repo: "IgorGuariroba/software-factories", coberto: true }),
    ]);
  });

  it("mostra o receptor ligado e o horário da última entrega do webhook aplicada", async () => {
    factory = await startTestFactory({ webhookSecret: "segredo-do-teste" });
    const antes = await api<Painel>(factory, "GET", "/github-app");
    expect(antes.receptor.ligado).toBe(true);
    expect(antes.receptor.porta).not.toBeNull();
    expect(antes.receptor.ultimaEntregaEm).toBeNull();

    const parsed = parseGitHubDelivery({
      event: "issues",
      deliveryId: "entrega-painel-1",
      body: {
        action: "edited",
        issue: { number: 3, title: "Editada", body: "", state: "open", labels: [] },
        repository: { full_name: "outro/repo" },
      },
    });
    if (parsed.kind !== "issues") throw new Error("entrega de teste inválida");
    await factory.applyGitHubDelivery(parsed.delivery);

    const depois = await api<Painel>(factory, "GET", "/github-app");
    expect(depois.receptor.ultimaEntregaEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("uma falha da consulta ao App aparece como erro, e a cobertura fica desconhecida", async () => {
    const falha = (async () => json({ message: "Bad credentials" }, 401)) as unknown as typeof fetch;
    factory = await startTestFactory({
      config: githubConfig("dono/repo"),
      githubApp: { appId: 5685212, privateKeyPath: await chaveNoDisco(), fetch: falha },
    });
    const painel = await api<Painel>(factory, "GET", "/github-app");
    expect(painel.app.erro).toBe("GitHub respondeu 401 em /app");
    expect(painel.repositorios[0]?.coberto).toBeNull();
  });
});

describe("GET /github/repos: catálogo do App com o plugue atual", () => {
  it("lista os repositórios do App com id e privacidade, e marca os plugados", async () => {
    factory = await startTestFactory({
      config: githubConfig("IgorGuariroba/software-factories"),
      githubApp: { appId: 5685212, privateKeyPath: await chaveNoDisco(), fetch: githubFalso },
    });
    const catalogo = await api<{
      configurado: boolean;
      repos: { id: number; nome: string; privado: boolean; plugado: { projeto: string; status: string } | null }[];
    }>(factory, "GET", "/github/repos");
    expect(catalogo.configurado).toBe(true);
    expect(catalogo.repos).toEqual([
      expect.objectContaining({
        id: 42,
        nome: "IgorGuariroba/software-factories",
        privado: false,
        plugado: expect.objectContaining({ status: "ativo" }),
      }),
    ]);
  });

  it("sem App configurado, responde sem repositórios e sem erro inventado", async () => {
    factory = await startTestFactory({ config: githubConfig("dono/repo") });
    const catalogo = await api<{ configurado: boolean; erro?: string; repos: unknown[] }>(
      factory,
      "GET",
      "/github/repos",
    );
    expect(catalogo).toMatchObject({ configurado: false, repos: [] });
    expect(catalogo.erro).toBeUndefined();
  });

  it("falha do GitHub vira erro, sem repositórios, e nunca expõe token", async () => {
    const falha = (async () => json({ message: "Bad credentials" }, 401)) as unknown as typeof fetch;
    factory = await startTestFactory({
      config: githubConfig("dono/repo"),
      githubApp: { appId: 5685212, privateKeyPath: await chaveNoDisco(), fetch: falha },
    });
    const bruto = JSON.stringify(await api(factory, "GET", "/github/repos"));
    expect(bruto).toContain("GitHub respondeu 401 em /app");
    expect(bruto).not.toContain("BEGIN");
    expect(bruto).not.toContain("ghs_");
  });
});

describe("POST /github/importar: importação de issues abertas pela fila", () => {
  const configComStatus = (repo: string): Partial<ProjectConfig> => ({
    ...githubConfig(repo),
    statuses: { aberta: "todo", fechada: "done" },
  });

  it("importa as issues abertas (sem PR) e não duplica ao repetir", async () => {
    factory = await startTestFactory({
      config: configComStatus("IgorGuariroba/software-factories"),
      githubApp: { appId: 5685212, privateKeyPath: await chaveNoDisco(), fetch: githubFalso },
    });
    const pedido = await chamada(factory, "POST", "/github/importar", { repoId: 42 });
    expect(pedido.status).toBe(202);

    const registro = await esperarImportacao(factory, 42);
    expect(registro).toMatchObject({ status: "ok", ultimoResultado: { criadas: 2, ignoradas: 0 } });
    const tarefas = await api<{ id: string }[]>(factory, "GET", "/tasks");
    expect(tarefas.map((t) => t.id).sort()).toEqual(["exemplo/SF-1", "exemplo/SF-2"]);

    await chamada(factory, "POST", "/github/importar", { repoId: 42 });
    const depois = await esperarImportacao(factory, 42);
    expect(depois.ultimoResultado).toMatchObject({ criadas: 0, atualizadas: 2 });
    expect((await api<unknown[]>(factory, "GET", "/tasks")).length).toBe(2);
  });

  it("repositório sem projeto configurado é recusado com 409 e não entra na fila", async () => {
    factory = await startTestFactory({
      config: configComStatus("outro/repo"),
      githubApp: { appId: 5685212, privateKeyPath: await chaveNoDisco(), fetch: githubFalso },
    });
    const pedido = await chamada(factory, "POST", "/github/importar", { repoId: 42 });
    expect(pedido.status).toBe(409);
    expect(JSON.stringify(pedido.body)).toContain("configure o projeto no YAML");
  });

  it("id fora do catálogo do App responde 404; corpo sem repoId responde 400", async () => {
    factory = await startTestFactory({
      config: configComStatus("IgorGuariroba/software-factories"),
      githubApp: { appId: 5685212, privateKeyPath: await chaveNoDisco(), fetch: githubFalso },
    });
    expect((await chamada(factory, "POST", "/github/importar", { repoId: 1 })).status).toBe(404);
    expect((await chamada(factory, "POST", "/github/importar", { repoId: "x" })).status).toBe(400);
  });

  it("falha do GitHub na leitura marca a importação como erro e não grava Tarefa pela metade", async () => {
    const falhaIssues = (async (url: string) => {
      if (new URL(url).pathname.endsWith("/issues")) return json({ message: "Forbidden" }, 403);
      return githubFalso(url);
    }) as unknown as typeof fetch;
    factory = await startTestFactory({
      config: configComStatus("IgorGuariroba/software-factories"),
      githubApp: { appId: 5685212, privateKeyPath: await chaveNoDisco(), fetch: falhaIssues },
    });
    await chamada(factory, "POST", "/github/importar", { repoId: 42 });
    const registro = await esperarImportacao(factory, 42);
    expect(registro).toMatchObject({ status: "erro" });
    expect(String(registro.ultimoErro)).toContain("GitHub respondeu 403");
    expect((await api<unknown[]>(factory, "GET", "/tasks")).length).toBe(0);
  });
});
