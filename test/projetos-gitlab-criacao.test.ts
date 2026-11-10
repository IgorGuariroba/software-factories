import { mkdir } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { api, startTestFactory, type TestFactory } from "./harness.js";

/** GitLab falso: o token `glpat-ok` vê `grupo/projeto` em gitlab.com e em gitlab.empresa.com; os outros são recusados. */
const chamadasGitlab: { host: string; token: string | null }[] = [];
/** Quando verdadeiro, a lista de membros do projeto não responde (GitLab fora do ar nessa consulta). */
let membrosFora = false;
/** Membros do projeto: quem pode ser PO ou tech lead na Fonte GitLab Issues. */
const membros = [
  { id: 11, username: "ana", name: "Ana Souza" },
  { id: 12, username: "bruno", name: "Bruno Lima" },
];
const gitlabFalso = (async (url: string, init?: RequestInit) => {
  const alvo = new URL(url);
  const token = new Headers(init?.headers).get("PRIVATE-TOKEN");
  chamadasGitlab.push({ host: alvo.host, token });
  if (token === "glpat-expirado") return new Response("{}", { status: 401 });
  if (token === "glpat-ok" && alvo.pathname === "/api/v4/projects/grupo%2Fprojeto") {
    return new Response(JSON.stringify({ path_with_namespace: "grupo/projeto" }), { status: 200 });
  }
  if (token === "glpat-ok" && alvo.pathname === "/api/v4/projects/grupo%2Fprojeto/members/all") {
    if (membrosFora) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(alvo.searchParams.get("page") === "1" ? membros : []), { status: 200 });
  }
  return new Response('{"message":"404 Project Not Found"}', { status: 404 });
}) as unknown as typeof fetch;

/** Clone falso: cria o diretório gerenciado, sem rede. */
const clonadas: { host: string; caminho: string; destino: string }[] = [];
const clonarFalso = async (opts: { host: string; caminho: string; destino: string }) => {
  clonadas.push(opts);
  await mkdir(opts.destino, { recursive: true });
};

/** Corpo mínimo de criação por caminho: servidor gitlab.com, token `glpat-ok` no cofre (cadastrado em cada teste). */
const corpo = (sobrescrita: Record<string, unknown> = {}) => ({
  nome: "app-gitlab",
  caminho: "grupo/projeto",
  servidor: "",
  fonte: { project: "GL", assignee: "fulano", credential: "gitlab-token" },
  comandoTeste: ["npm", "test"],
  ...sobrescrita,
});

/** Chamada que devolve o status mesmo fora do 2xx. */
async function chamada(f: TestFactory, method: string, path: string, body?: unknown) {
  const res = await fetch(`${f.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function subirFabrica(token = "glpat-ok") {
  const f = await startTestFactory({ fetchGitlab: gitlabFalso, clonarRepositorioGitlab: clonarFalso });
  await api(f, "PUT", "/segredos/gitlab-token", { valor: token });
  return f;
}

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
  chamadasGitlab.length = 0;
  clonadas.length = 0;
  membrosFora = false;
});

describe("POST /projetos/gitlab: criar projeto por caminho completo, com o token do cofre", () => {
  it("cria o projeto com a Fonte GitLab Issues, clona o repositório pela fábrica e nasce incompleto", async () => {
    factory = await subirFabrica();
    const criado = await chamada(factory, "POST", "/projetos/gitlab", corpo());
    expect(criado.status).toBe(201);
    expect(criado.body).toMatchObject({
      projeto: "app-gitlab",
      repo: "grupo/projeto",
      prefixo: "GL",
      fonte: "gitlab",
      ensaio: true,
      horario: "business-hours",
      estado: "incompleto",
    });

    const configuracao = await api<{
      source: { type: string; repo: string; credential: string; hostname?: string };
      repositories: { path: string }[];
    }>(factory, "GET", "/projetos/app-gitlab/configuracao");
    expect(configuracao.source).toMatchObject({ type: "gitlab", repo: "grupo/projeto", credential: "gitlab-token" });
    expect(configuracao.source.hostname).toBeUndefined();
    expect(clonadas).toEqual([expect.objectContaining({ host: "gitlab.com", caminho: "grupo/projeto" })]);
    expect(configuracao.repositories[0]?.path).toBe(clonadas[0]?.destino);
  });

  it("servidor self-hosted: a URL vira o host da Fonte e é o servidor conferido e clonado", async () => {
    factory = await subirFabrica();
    const criado = await chamada(
      factory,
      "POST",
      "/projetos/gitlab",
      corpo({ servidor: "https://gitlab.empresa.com" }),
    );
    expect(criado.status).toBe(201);
    const configuracao = await api<{ source: { hostname?: string } }>(
      factory,
      "GET",
      "/projetos/app-gitlab/configuracao",
    );
    expect(configuracao.source.hostname).toBe("gitlab.empresa.com");
    expect(chamadasGitlab.map((c) => c.host)).toEqual(["gitlab.empresa.com"]);
    expect(clonadas[0]?.host).toBe("gitlab.empresa.com");
  });

  it("o token é enviado ao GitLab na conferência, sem aparecer na resposta nem na configuração", async () => {
    factory = await subirFabrica();
    const criado = await chamada(factory, "POST", "/projetos/gitlab", corpo());
    expect(criado.status).toBe(201);
    expect(chamadasGitlab[0]?.token).toBe("glpat-ok");
    expect(JSON.stringify(criado.body)).not.toContain("glpat-ok");
    const configuracao = await api(factory, "GET", "/projetos/app-gitlab/configuracao");
    expect(JSON.stringify(configuracao)).not.toContain("glpat-ok");
  });

  it("caminho que não existe ou que o token não enxerga é recusado com a causa, sem gravar nada", async () => {
    factory = await subirFabrica();
    const res = await chamada(factory, "POST", "/projetos/gitlab", corpo({ caminho: "grupo/sumiu" }));
    expect(res.status).toBe(400);
    expect(String(res.body?.error)).toContain("o repositório grupo/sumiu não existe em gitlab.com");
    expect(String(res.body?.error)).toContain("o token não tem acesso");
    expect(clonadas).toHaveLength(0);
    expect((await chamada(factory, "GET", "/projetos/app-gitlab/configuracao")).status).toBe(404);
  });

  it("token inválido ou expirado é recusado antes de salvar", async () => {
    factory = await subirFabrica("glpat-expirado");
    const res = await chamada(factory, "POST", "/projetos/gitlab", corpo());
    expect(res.status).toBe(400);
    expect(String(res.body?.error)).toContain("é inválido ou expirou");
    expect(clonadas).toHaveLength(0);
  });

  it("sem credencial do cofre a criação é recusada, e a credencial precisa estar cadastrada", async () => {
    factory = await subirFabrica();
    const semCredencial = await chamada(
      factory,
      "POST",
      "/projetos/gitlab",
      corpo({ fonte: { project: "GL", assignee: "fulano" } }),
    );
    expect(semCredencial.status).toBe(400);
    expect(String(semCredencial.body?.error)).toContain("informe a credencial do token do GitLab");

    const naoCadastrada = await chamada(
      factory,
      "POST",
      "/projetos/gitlab",
      corpo({ fonte: { project: "GL", assignee: "fulano", credential: "outro-token" } }),
    );
    expect(naoCadastrada.status).toBe(400);
    expect(String(naoCadastrada.body?.error)).toContain("credencial outro-token não cadastrada");
  });

  it("servidor que não é URL https é recusado com a regra em português", async () => {
    factory = await subirFabrica();
    const res = await chamada(factory, "POST", "/projetos/gitlab", corpo({ servidor: "http://gitlab.empresa.com" }));
    expect(res.status).toBe(400);
    expect(String(res.body?.error)).toContain("servidor: informe a URL do GitLab");
  });

  it("caminho sem grupo é recusado pelo schema da Fonte", async () => {
    factory = await subirFabrica();
    const res = await chamada(factory, "POST", "/projetos/gitlab", corpo({ caminho: "so-projeto" }));
    expect(res.status).toBe(400);
    expect(String(res.body?.error)).toContain("use grupo/projeto");
  });

  it("se a clonagem falha, a criação responde 502 e nada fica salvo", async () => {
    factory = await startTestFactory({
      fetchGitlab: gitlabFalso,
      clonarRepositorioGitlab: async () => {
        throw new Error("não foi possível clonar grupo/projeto do GitLab em gitlab.com");
      },
    });
    await api(factory, "PUT", "/segredos/gitlab-token", { valor: "glpat-ok" });
    const res = await chamada(factory, "POST", "/projetos/gitlab", corpo());
    expect(res.status).toBe(502);
    expect((await chamada(factory, "GET", "/projetos/app-gitlab/configuracao")).status).toBe(404);
  });

  it("o nome e o prefixo não podem repetir o que já existe, como na criação pelo GitHub", async () => {
    factory = await subirFabrica();
    const res = await chamada(factory, "POST", "/projetos/gitlab", corpo({ nome: "exemplo" }));
    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("já existe um projeto chamado exemplo");
  });

  it("a criação pelo GitHub não aceita a Fonte GitLab: ela é criada por caminho", async () => {
    factory = await subirFabrica();
    const res = await chamada(factory, "POST", "/projetos/github", {
      repoId: 77,
      nome: "outro",
      fonte: { type: "gitlab", project: "GL", assignee: "fulano", repo: "grupo/projeto" },
      comandoTeste: ["npm", "test"],
    });
    expect(res.status).toBe(400);
    expect(String(res.body?.error)).toContain("POST /projetos/gitlab");
  });

  it("o mesmo repositório com a mesma Fonte GitLab é recusado com o nome do projeto que já a usa, antes de consultar o GitLab", async () => {
    factory = await subirFabrica();
    expect((await chamada(factory, "POST", "/projetos/gitlab", corpo())).status).toBe(201);
    const chamadasAntes = chamadasGitlab.length;
    const res = await chamada(
      factory,
      "POST",
      "/projetos/gitlab",
      corpo({ nome: "outro", fonte: { project: "OU", assignee: "fulano", credential: "gitlab-token" } }),
    );
    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("grupo/projeto já tem a Fonte gitlab de issues no projeto app-gitlab");
    expect(chamadasGitlab.length).toBe(chamadasAntes);
    expect(clonadas).toHaveLength(1);
  });

  it("o prefixo de um projeto criado por caminho fica reservado para os seguintes", async () => {
    factory = await subirFabrica();
    expect((await chamada(factory, "POST", "/projetos/gitlab", corpo())).status).toBe(201);
    const res = await chamada(
      factory,
      "POST",
      "/projetos/gitlab",
      corpo({
        nome: "outro",
        caminho: "grupo/outro",
        fonte: { project: "gl", assignee: "fulano", credential: "gitlab-token" },
      }),
    );
    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toContain("o prefixo GL já é usado pelo projeto app-gitlab");
  });

  it("PO e tech lead escolhidos na lista da Fonte são gravados com o perfil certo, sem padrão pelo dono do repositório", async () => {
    factory = await subirFabrica();
    const criado = await chamada(
      factory,
      "POST",
      "/projetos/gitlab",
      corpo({ pessoas: { po: "ana", techLead: "bruno" } }),
    );
    expect(criado.status).toBe(201);
    expect(criado.body).toMatchObject({ estado: "incompleto", pendencias: ["falta um provedor permitido"] });
    const configuracao = await api<{
      people: { id: string; perfis: string[]; identidades: Record<string, string>; name?: string }[];
    }>(factory, "GET", "/projetos/app-gitlab/configuracao");
    expect(configuracao.people).toEqual([
      { id: "ana", perfis: ["PO"], name: "Ana Souza", identidades: { gitlab: "ana" } },
      { id: "bruno", perfis: ["Tech Lead"], name: "Bruno Lima", identidades: { gitlab: "bruno" } },
    ]);
  });

  it("sem escolha de PO e tech lead, a Fonte não é consultada e o projeto nasce incompleto com as duas pendências", async () => {
    factory = await subirFabrica();
    membrosFora = true;
    const criado = await chamada(factory, "POST", "/projetos/gitlab", corpo());
    expect(criado.status).toBe(201);
    expect(criado.body).toMatchObject({ estado: "incompleto" });
    expect(criado.body?.pendencias).toEqual([
      "falta uma pessoa no perfil PO",
      "falta uma pessoa no perfil tech lead",
      "falta um provedor permitido",
    ]);
  });

  it("pessoa escolhida que a Fonte não conhece é recusada com 400, e nada é gravado", async () => {
    factory = await subirFabrica();
    const res = await chamada(factory, "POST", "/projetos/gitlab", corpo({ pessoas: { po: "fantasma" } }));
    expect(res.status).toBe(400);
    expect(String(res.body?.error)).toContain("PO: fantasma não existe na Fonte GitLab Issues");
    expect(clonadas).toHaveLength(0);
    expect((await chamada(factory, "GET", "/projetos/app-gitlab/configuracao")).status).toBe(404);
  });

  it("Fonte fora do ar na conferência de pessoas: 502 com a causa, nada é gravado nem clonado", async () => {
    factory = await subirFabrica();
    membrosFora = true;
    const res = await chamada(factory, "POST", "/projetos/gitlab", corpo({ pessoas: { techLead: "bruno" } }));
    expect(res.status).toBe(502);
    expect(String(res.body?.error)).toContain("não foi possível consultar as pessoas na Fonte GitLab Issues");
    expect(String(res.body?.error)).toContain("o projeto não foi salvo");
    expect(clonadas).toHaveLength(0);
    expect((await chamada(factory, "GET", "/projetos/app-gitlab/configuracao")).status).toBe(404);
  });

  it("a lista de pessoas da Fonte para o formulário vem do GitLab com o token do cofre", async () => {
    factory = await subirFabrica();
    const lista = await chamada(factory, "POST", "/projetos/pessoas-da-fonte", {
      tipo: "gitlab",
      caminho: "grupo/projeto",
      servidor: "",
      credencial: "gitlab-token",
    });
    expect(lista.status).toBe(200);
    expect(lista.body).toEqual([
      { id: "ana", nome: "Ana Souza" },
      { id: "bruno", nome: "Bruno Lima" },
    ]);
  });

  it("a lista de pessoas recusa credencial que não está no cofre e servidor que não é URL https", async () => {
    factory = await subirFabrica();
    const semCredencial = await chamada(factory, "POST", "/projetos/pessoas-da-fonte", {
      tipo: "gitlab",
      caminho: "grupo/projeto",
      credencial: "outro-token",
    });
    expect(semCredencial.status).toBe(400);
    const servidorRuim = await chamada(factory, "POST", "/projetos/pessoas-da-fonte", {
      tipo: "gitlab",
      caminho: "grupo/projeto",
      servidor: "http://gitlab.empresa.com",
      credencial: "gitlab-token",
    });
    expect(servidorRuim.status).toBe(400);
  });

  it("a lista de pessoas com a Fonte fora do ar responde 502 com a causa", async () => {
    factory = await subirFabrica();
    membrosFora = true;
    const res = await chamada(factory, "POST", "/projetos/pessoas-da-fonte", {
      tipo: "gitlab",
      caminho: "grupo/projeto",
      credencial: "gitlab-token",
    });
    expect(res.status).toBe(502);
    expect(String(res.body?.error)).toContain("não foi possível consultar as pessoas na Fonte GitLab Issues");
  });
});
