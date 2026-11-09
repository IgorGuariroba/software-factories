import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import { api, startTestFactory, type TestFactory } from "./harness.js";

const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** API do GitHub falsa: o App com uma instalação que cobre dois repositórios (ids 42 e 77). */
const githubFalso = (async (url: string) => {
  const caminho = new URL(url).pathname;
  if (caminho === "/app") return json({ id: 5685212, slug: "fabrica-igor-sf", name: "fabrica-igor-sf" });
  if (caminho === "/app/installations") {
    return json([{ id: 180265101, account: { login: "IgorGuariroba" }, repository_selection: "selected" }]);
  }
  if (caminho === "/app/installations/180265101/access_tokens") return json({ token: "ghs_token_falso" });
  if (caminho === "/installation/repositories") {
    return json({
      repositories: [
        { id: 42, full_name: "IgorGuariroba/software-factories", private: false, owner: { login: "IgorGuariroba" } },
        { id: 77, full_name: "IgorGuariroba/novo-repo", private: true, owner: { login: "IgorGuariroba" } },
      ],
    });
  }
  if (caminho === "/repos/IgorGuariroba/novo-repo/issues") {
    return json([{ id: 7001, number: 1, title: "Primeira do repo novo", body: "", state: "open", labels: [] }]);
  }
  return json({ message: "Not Found" }, 404);
}) as unknown as typeof fetch;

/** Projeto do YAML (referência): repositório da própria fábrica, com os estados que a criação herda. */
const configYaml = (): Partial<ProjectConfig> => ({
  source: {
    type: "github",
    project: "SF",
    repo: "IgorGuariroba/software-factories",
    assignee: "IgorGuariroba",
    triageApproval: false,
    maxActive: 1,
    ignoreLabels: ["epic"],
  } as ProjectConfig["source"],
  statuses: { aberta: "todo", fechada: "done" },
});

const app = async () => ({
  appId: 5685212,
  privateKeyPath: await chaveNoDisco(),
  fetch: githubFalso,
});

async function chaveNoDisco(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fabrica-chave-projeto-"));
  const caminho = join(dir, "app.private-key.pem");
  await writeFile(caminho, PEM, { mode: 0o600 });
  return caminho;
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

async function esperarImportacao(f: TestFactory, repoId: number) {
  for (let i = 0; i < 200; i++) {
    const catalogo = await api<{ repos: { id: number; importacao: { status: string } | null }[] }>(
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

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

describe("POST /projetos/github: criar projeto a partir de um repositório do App", () => {
  it("cria o projeto em ensaio, com o repositório plugado, e ele aparece na lista de repositórios", async () => {
    factory = await startTestFactory({ config: configYaml(), githubApp: await app() });
    const criado = await chamada(factory, "POST", "/projetos/github", {
      repoId: 77,
      nome: "novo-repo",
      prefixo: "nr",
    });
    expect(criado.status).toBe(201);
    expect(criado.body).toMatchObject({
      projeto: "novo-repo",
      repo: "IgorGuariroba/novo-repo",
      prefixo: "NR",
      ensaio: true,
    });

    const repos = await api<{ project: string; repo: string; status: string }[]>(factory, "GET", "/repos");
    expect(repos).toContainEqual(
      expect.objectContaining({ project: "novo-repo", repo: "IgorGuariroba/novo-repo", status: "ativo" }),
    );

    const catalogo = await api<{ repos: { id: number; plugado: { projeto: string } | null }[] }>(
      factory,
      "GET",
      "/github/repos",
    );
    expect(catalogo.repos.find((r) => r.id === 77)?.plugado).toMatchObject({ projeto: "novo-repo" });
  });

  it("a importação funciona logo depois de criar, sem reiniciar o daemon", async () => {
    factory = await startTestFactory({ config: configYaml(), githubApp: await app() });
    await chamada(factory, "POST", "/projetos/github", { repoId: 77, nome: "novo-repo", prefixo: "NR" });
    expect((await chamada(factory, "POST", "/github/importar", { repoId: 77 })).status).toBe(202);
    const registro = await esperarImportacao(factory, 77);
    expect(registro).toMatchObject({ status: "ok", ultimoResultado: { criadas: 1 } });
    const tarefas = await api<{ id: string }[]>(factory, "GET", "/tasks");
    expect(tarefas.map((t) => t.id)).toEqual(["novo-repo/NR-1"]);
  });

  it("o projeto criado sobrevive a um reinício do daemon", async () => {
    factory = await startTestFactory({ config: configYaml(), githubApp: await app() });
    await chamada(factory, "POST", "/projetos/github", { repoId: 77, nome: "novo-repo", prefixo: "NR" });
    factory = await factory.restart();
    const repos = await api<{ project: string }[]>(factory, "GET", "/repos");
    expect(repos.map((r) => r.project)).toContain("novo-repo");
    expect((await chamada(factory, "POST", "/github/importar", { repoId: 77 })).status).toBe(202);
  });

  it("nome igual ao de um projeto do YAML é recusado (o YAML nunca é sobrescrito)", async () => {
    factory = await startTestFactory({ config: configYaml(), githubApp: await app() });
    const res = await chamada(factory, "POST", "/projetos/github", { repoId: 77, nome: "exemplo", prefixo: "NR" });
    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("já existe um projeto chamado exemplo");
  });

  it("prefixo já usado pelo YAML é recusado, sem diferenciar caixa", async () => {
    factory = await startTestFactory({ config: configYaml(), githubApp: await app() });
    const res = await chamada(factory, "POST", "/projetos/github", { repoId: 77, nome: "novo-repo", prefixo: "sf" });
    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("prefixo SF");
  });

  it("repositório já monitorado pelo YAML não ganha um segundo projeto", async () => {
    factory = await startTestFactory({ config: configYaml(), githubApp: await app() });
    const res = await chamada(factory, "POST", "/projetos/github", { repoId: 42, nome: "outro", prefixo: "OU" });
    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("já é monitorado");
  });

  it("nome inválido responde 400 com a regra; repositório fora do catálogo responde 404", async () => {
    factory = await startTestFactory({ config: configYaml(), githubApp: await app() });
    const invalido = await chamada(factory, "POST", "/projetos/github", {
      repoId: 77,
      nome: "Com Espaço",
      prefixo: "NR",
    });
    expect(invalido.status).toBe(400);
    expect(String(invalido.body?.error)).toContain("nome: use minúsculas");
    expect(
      (await chamada(factory, "POST", "/projetos/github", { repoId: 999, nome: "novo", prefixo: "NV" })).status,
    ).toBe(404);
  });

  it("corpo sem os campos responde 400", async () => {
    factory = await startTestFactory({ config: configYaml(), githubApp: await app() });
    expect((await chamada(factory, "POST", "/projetos/github", { repoId: 77 })).status).toBe(400);
  });

  it("sem App configurado, não cria nada e diz por quê", async () => {
    factory = await startTestFactory({ config: configYaml() });
    const res = await chamada(factory, "POST", "/projetos/github", { repoId: 77, nome: "novo-repo", prefixo: "NR" });
    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("GitHub App não configurado");
  });
});
