import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";
import { api, poll, startTestFactory, type TestFactory } from "./harness.js";

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
  if (caminho === "/repos/IgorGuariroba/novo-repo/assignees") {
    return json([{ login: "IgorGuariroba" }, { login: "colega" }]);
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

/** Clone falso: cria o diretório gerenciado, sem rede. A fábrica decide o destino, nunca o usuário. */
const clonarFalso = async (opts: { destino: string }) => {
  await mkdir(opts.destino, { recursive: true });
};

/** Fonte GitHub Issues do próprio repositório, como o formulário sugere. */
const fonteGithub = (assignee = "IgorGuariroba") => ({ type: "github", project: "NR", assignee });

/** Corpo mínimo de criação: repositório, nome, Fonte, comando de teste. */
const corpo = (sobrescrita: Record<string, unknown> = {}) => ({
  repoId: 77,
  nome: "novo-repo",
  fonte: fonteGithub(),
  comandoTeste: ["npm", "test"],
  ...sobrescrita,
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

const subirFabrica = async (extra: Parameters<typeof startTestFactory>[0] = {}) =>
  startTestFactory({ config: configYaml(), githubApp: await app(), clonarRepositorio: clonarFalso, ...extra });

describe("POST /projetos/github: criar projeto a partir de um repositório do App", () => {
  it("cria o projeto com a Fonte escolhida, clonado pela fábrica, e ele aparece na lista de repositórios", async () => {
    factory = await subirFabrica();
    const criado = await chamada(factory, "POST", "/projetos/github", corpo());
    expect(criado.status).toBe(201);
    expect(criado.body).toMatchObject({
      projeto: "novo-repo",
      repo: "IgorGuariroba/novo-repo",
      prefixo: "NR",
      fonte: "github",
      ensaio: true,
      horario: "business-hours",
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

  it("o caminho do clone é gerenciado pela fábrica: o corpo não consegue escolher outro", async () => {
    factory = await subirFabrica();
    await chamada(factory, "POST", "/projetos/github", { ...corpo(), caminho: "/etc" });
    const configuracao = await api<{ repositories: { path: string }[] }>(
      factory,
      "GET",
      "/projetos/novo-repo/configuracao",
    );
    expect(configuracao.repositories[0]?.path).toMatch(/repositorios[\\/]novo-repo$/);
  });

  it("o projeto criado nasce incompleto e a lista diz o que falta (PO e tech lead)", async () => {
    factory = await subirFabrica();
    await chamada(factory, "POST", "/projetos/github", corpo());
    const situacao = await api<{ estado: string; pendencias: string[] }>(factory, "GET", "/projetos/novo-repo/estado");
    expect(situacao.estado).toBe("incompleto");
    expect(situacao.pendencias).toEqual(
      expect.arrayContaining(["falta uma pessoa no perfil PO", "falta uma pessoa no perfil tech lead"]),
    );
  });

  it("horário padrão é horário comercial; sempre ativo e ensaio desligado são escolhas da criação", async () => {
    factory = await subirFabrica();
    await chamada(factory, "POST", "/projetos/github", corpo());
    expect((await api<{ activity: string }>(factory, "GET", "/projetos/novo-repo/configuracao")).activity).toBe(
      "business-hours",
    );

    const outro = await chamada(factory, "POST", "/projetos/github", {
      ...corpo({ nome: "sempre-ativo", fonte: fonteGithub() }),
      repoId: 42,
      fonte: { type: "jira", project: "SA", assignee: "accountid-1", baseUrl: "https://empresa.atlassian.net" },
      horario: "always",
      ensaio: false,
    });
    expect(outro.status).toBe(201);
    expect(outro.body).toMatchObject({ horario: "always", ensaio: false, fonte: "jira" });
  });

  it("a Fonte de GitHub Issues do mesmo repositório que outro projeto já usa é recusada, com o nome do projeto", async () => {
    factory = await subirFabrica();
    const res = await chamada(factory, "POST", "/projetos/github", {
      ...corpo({ fonte: { type: "github", project: "OU", assignee: "dono" } }),
      repoId: 42,
      nome: "outro",
    });
    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("já tem a Fonte github de issues no projeto exemplo");
  });

  it("o mesmo repositório com Fonte Jira é permitido: projetos com Jira e código no GitHub", async () => {
    factory = await subirFabrica();
    const res = await chamada(factory, "POST", "/projetos/github", {
      ...corpo({
        fonte: { type: "jira", project: "OU", assignee: "accountid-1", baseUrl: "https://empresa.atlassian.net" },
      }),
      repoId: 42,
      nome: "outro",
    });
    expect(res.status).toBe(201);
  });

  it("nome igual ao de um projeto do YAML é recusado (o YAML nunca é sobrescrito)", async () => {
    factory = await subirFabrica();
    const res = await chamada(factory, "POST", "/projetos/github", corpo({ nome: "exemplo" }));
    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("já existe um projeto chamado exemplo");
  });

  it("prefixo já usado pelo YAML é recusado, sem diferenciar caixa", async () => {
    factory = await subirFabrica();
    const res = await chamada(
      factory,
      "POST",
      "/projetos/github",
      corpo({ fonte: { type: "github", project: "sf", assignee: "dono" } }),
    );
    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("prefixo SF");
  });

  it("se a clonagem falha, a criação responde 502 e nada fica salvo", async () => {
    factory = await subirFabrica({
      clonarRepositorio: async () => {
        throw new Error("não foi possível clonar IgorGuariroba/novo-repo pelo GitHub App");
      },
    });
    const res = await chamada(factory, "POST", "/projetos/github", corpo());
    expect(res.status).toBe(502);
    expect(String(res.body?.error)).toContain("não foi possível clonar");
    expect((await fetch(`${factory.url}/projetos/novo-repo/estado`)).status).toBe(404);
  });

  it("projeto incompleto não entra na fila; completo com PO e tech lead, sim", async () => {
    const card = {
      key: "NR-1",
      title: "Primeira",
      description: "Descrição",
      status: "aberta",
      assignee: "IgorGuariroba",
    };
    factory = await subirFabrica({ createSource: () => new MemoryDemandSource([card]) });
    await chamada(factory, "POST", "/projetos/github", corpo());

    await poll(factory);
    expect((await api<{ id: string }[]>(factory, "GET", "/tasks")).map((t) => t.id)).not.toContain("novo-repo/NR-1");

    const atual = await api<Record<string, unknown>>(factory, "GET", "/projetos/novo-repo/configuracao");
    await api(factory, "PUT", "/projetos/novo-repo/configuracao", {
      ...atual,
      allowedProviders: ["anthropic"],
      people: [
        { id: "po-x", role: "po" },
        { id: "tl-x", role: "tech_lead" },
      ],
    });
    await poll(factory);
    expect((await api<{ id: string }[]>(factory, "GET", "/tasks")).map((t) => t.id)).toContain("novo-repo/NR-1");
  });

  it("projeto que perde o PO não executa: a Tarefa já enfileirada espera o projeto voltar a ficar pronto", async () => {
    const card = {
      key: "NR-1",
      title: "Primeira",
      description: "Descrição",
      status: "aberta",
      assignee: "IgorGuariroba",
    };
    factory = await subirFabrica({ createSource: () => new MemoryDemandSource([card]) });
    await chamada(factory, "POST", "/projetos/github", corpo({ horario: "always" }));
    const atual = await api<Record<string, unknown>>(factory, "GET", "/projetos/novo-repo/configuracao");
    const completo = {
      ...atual,
      allowedProviders: ["anthropic"],
      people: [
        { id: "po-x", role: "po" },
        { id: "tl-x", role: "tech_lead" },
      ],
    };
    await api(factory, "PUT", "/projetos/novo-repo/configuracao", completo);
    // Com o daemon pausado, a Tarefa fica enfileirada até a retomada.
    await api(factory, "POST", "/daemon/pause");
    await poll(factory);
    const daFactory = factory;
    const status = async () =>
      (await api<{ id: string; status: string }[]>(daFactory, "GET", "/tasks")).find((t) => t.id === "novo-repo/NR-1")
        ?.status;
    expect(await status()).toBe("enfileirada");

    await api(factory, "PUT", "/projetos/novo-repo/configuracao", {
      ...completo,
      people: [{ id: "tl-x", role: "tech_lead" }],
    });
    await api(factory, "POST", "/daemon/resume");
    await poll(factory);
    expect(await status()).toBe("enfileirada");

    await api(factory, "PUT", "/projetos/novo-repo/configuracao", completo);
    await poll(factory);
    expect(await status()).toBe("ativa");
  });

  it("importar um projeto incompleto é recusado, com o que falta", async () => {
    factory = await subirFabrica();
    await chamada(factory, "POST", "/projetos/github", corpo());
    const res = await chamada(factory, "POST", "/github/importar", { repoId: 77 });
    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("incompleto: falta uma pessoa no perfil PO");
  });

  it("a importação funciona logo depois de completar o projeto, sem reiniciar o daemon", async () => {
    factory = await subirFabrica();
    await chamada(factory, "POST", "/projetos/github", corpo());
    const atual = await api<Record<string, unknown>>(factory, "GET", "/projetos/novo-repo/configuracao");
    await api(factory, "PUT", "/projetos/novo-repo/configuracao", {
      ...atual,
      allowedProviders: ["anthropic"],
      people: [
        { id: "po-x", role: "po" },
        { id: "tl-x", role: "tech_lead" },
      ],
    });
    expect((await chamada(factory, "POST", "/github/importar", { repoId: 77 })).status).toBe(202);
    const registro = await esperarImportacao(factory, 77);
    expect(registro).toMatchObject({ status: "ok", ultimoResultado: { criadas: 1 } });
    const tarefas = await api<{ id: string }[]>(factory, "GET", "/tasks");
    expect(tarefas.map((t) => t.id)).toEqual(["novo-repo/NR-1"]);
  });

  it("o projeto criado e as edições dele sobrevivem a um reinício do daemon", async () => {
    factory = await subirFabrica();
    await chamada(factory, "POST", "/projetos/github", corpo());
    const atual = await api<Record<string, unknown>>(factory, "GET", "/projetos/novo-repo/configuracao");
    await api(factory, "PUT", "/projetos/novo-repo/configuracao", {
      ...atual,
      allowedProviders: ["anthropic"],
      people: [
        { id: "po-x", role: "po" },
        { id: "tl-x", role: "tech_lead" },
      ],
    });
    factory = await factory.restart();
    const repos = await api<{ project: string }[]>(factory, "GET", "/repos");
    expect(repos.map((r) => r.project)).toContain("novo-repo");
    expect(await api(factory, "GET", "/projetos/novo-repo/estado")).toEqual({
      estado: "ativo",
      pendencias: [],
      aguardandoConfirmacao: false,
    });
    expect((await chamada(factory, "POST", "/github/importar", { repoId: 77 })).status).toBe(202);
  });

  it("nome inválido responde 400 com a regra; repositório fora do catálogo responde 404", async () => {
    factory = await subirFabrica();
    const invalido = await chamada(factory, "POST", "/projetos/github", corpo({ nome: "Com Espaço" }));
    expect(invalido.status).toBe(400);
    expect(String(invalido.body?.error)).toContain("nome: use minúsculas");
    expect((await chamada(factory, "POST", "/projetos/github", corpo({ repoId: 999, nome: "novo" }))).status).toBe(404);
  });

  it("corpo sem os campos ou sem Fonte responde 400", async () => {
    factory = await subirFabrica();
    expect((await chamada(factory, "POST", "/projetos/github", { repoId: 77 })).status).toBe(400);
    expect((await chamada(factory, "POST", "/projetos/github", corpo({ fonte: undefined }))).status).toBe(400);
  });

  it("sem comando de teste, o projeto nasce incompleto com a pendência do comando", async () => {
    factory = await subirFabrica();
    const criado = await chamada(factory, "POST", "/projetos/github", corpo({ comandoTeste: [] }));
    expect(criado.status).toBe(201);
    expect(criado.body).toMatchObject({ estado: "incompleto" });
    expect(criado.body?.pendencias).toContain("falta o comando de teste");
  });

  it("sem App configurado, não cria nada e diz por quê", async () => {
    factory = await startTestFactory({ config: configYaml(), clonarRepositorio: clonarFalso });
    const res = await chamada(factory, "POST", "/projetos/github", corpo());
    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("GitHub App não configurado");
  });

  it("PO e tech lead escolhidos entre os responsáveis do repositório são gravados; quem não existe é recusado sem gravar", async () => {
    factory = await subirFabrica();
    const recusado = await chamada(factory, "POST", "/projetos/github", corpo({ pessoas: { po: "fantasma" } }));
    expect(recusado.status).toBe(400);
    expect(String(recusado.body?.error)).toContain("PO: fantasma não existe na Fonte GitHub Issues");
    expect((await chamada(factory, "GET", "/projetos/novo-repo/configuracao")).status).toBe(404);

    const criado = await chamada(
      factory,
      "POST",
      "/projetos/github",
      corpo({ pessoas: { po: "IgorGuariroba", techLead: "colega" } }),
    );
    expect(criado.status).toBe(201);
    expect(criado.body).toMatchObject({ estado: "incompleto", pendencias: ["falta um provedor permitido"] });
    const configuracao = await api<{ people: { id: string; perfis: string[]; name?: string }[] }>(
      factory,
      "GET",
      "/projetos/novo-repo/configuracao",
    );
    expect(configuracao.people).toEqual([
      { id: "IgorGuariroba", perfis: ["PO"], name: "IgorGuariroba", identidades: { github: "IgorGuariroba" } },
      { id: "colega", perfis: ["Tech Lead"], name: "colega", identidades: { github: "colega" } },
    ]);
  });

  it("a lista de responsáveis do formulário vem do repositório do App; repositório fora do catálogo responde 404", async () => {
    factory = await subirFabrica();
    const lista = await chamada(factory, "POST", "/projetos/pessoas-da-fonte", { tipo: "github", repoId: 77 });
    expect(lista.status).toBe(200);
    expect(lista.body).toEqual([
      { id: "IgorGuariroba", nome: "IgorGuariroba" },
      { id: "colega", nome: "colega" },
    ]);
    const fora = await chamada(factory, "POST", "/projetos/pessoas-da-fonte", { tipo: "github", repoId: 999 });
    expect(fora.status).toBe(404);
  });
});
