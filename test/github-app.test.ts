import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cobertura, createAppJwt, createGitHubAppChecker, type GitHubAppInstallation } from "../src/github-app.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const AGORA = Date.UTC(2026, 10, 9, 12, 0, 0);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** API do GitHub falsa: um App com uma instalação que cobre um repositório. */
function githubFalso(opts: { appStatus?: number; repos?: string[] } = {}) {
  const chamadas: { metodo: string; url: string; authorization: string | null }[] = [];
  const fetchFalso = async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    const authorization = new Headers(init?.headers).get("authorization");
    chamadas.push({ metodo, url, authorization });
    const caminho = new URL(url).pathname;
    if (caminho === "/app") {
      if (opts.appStatus) return json({ message: "Bad credentials" }, opts.appStatus);
      return json({ id: 5685212, slug: "fabrica-igor-sf", name: "fabrica-igor-sf" });
    }
    if (caminho === "/app/installations") {
      return json([{ id: 180265101, account: { login: "IgorGuariroba" }, repository_selection: "selected" }]);
    }
    if (caminho === "/app/installations/180265101/access_tokens") return json({ token: "ghs_token_falso" });
    if (caminho === "/installation/repositories") {
      return json({
        repositories: (opts.repos ?? ["IgorGuariroba/software-factories"]).map((full_name) => ({ full_name })),
      });
    }
    return json({ message: "Not Found" }, 404);
  };
  return { chamadas, fetch: fetchFalso as unknown as typeof fetch };
}

const instalacao = (over: Partial<GitHubAppInstallation> = {}): GitHubAppInstallation => ({
  id: 1,
  conta: "IgorGuariroba",
  selecao: "selected",
  repositorios: ["IgorGuariroba/software-factories"],
  ...over,
});

describe("createAppJwt: o JWT que autentica o App", () => {
  it("é RS256 assinado pela chave, com iss = App ID e validade de até 10 minutos", () => {
    const jwt = createAppJwt({ appId: 5685212, privateKeyPem: PEM, nowMs: AGORA });
    const [h, p, s] = jwt.split(".");
    const decode = (x: string | undefined) => JSON.parse(Buffer.from(x ?? "", "base64url").toString());
    expect(decode(h)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(p)).toMatchObject({ iss: "5685212" });
    expect(decode(p).exp - decode(p).iat).toBeLessThanOrEqual(600);
    const valido = verify("sha256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s ?? "", "base64url"));
    expect(valido).toBe(true);
  });
});

describe("cobertura: quais repositórios plugados o App cobre", () => {
  it("cobre o repositório listado, sem diferenciar caixa", () => {
    const mapa = cobertura(["igorguariroba/Software-Factories"], [instalacao()]);
    expect(mapa.get("igorguariroba/Software-Factories")).toBe(true);
  });

  it("não cobre repositório fora da seleção da instalação", () => {
    const mapa = cobertura(["IgorGuariroba/outro"], [instalacao()]);
    expect(mapa.get("IgorGuariroba/outro")).toBe(false);
  });

  it("uma instalação de todos os repositórios da conta cobre o repositório do dono", () => {
    const mapa = cobertura(["IgorGuariroba/outro"], [instalacao({ selecao: "all", repositorios: [] })]);
    expect(mapa.get("IgorGuariroba/outro")).toBe(true);
  });

  it("sem consulta ao App, a cobertura é desconhecida (null), não falsa", () => {
    const mapa = cobertura(["IgorGuariroba/software-factories"], undefined);
    expect(mapa.get("IgorGuariroba/software-factories")).toBeNull();
  });
});

describe("createGitHubAppChecker", () => {
  it("sem App ID ou sem chave, responde não configurado e não chama a rede", async () => {
    const gh = githubFalso();
    const checker = createGitHubAppChecker({ fetch: gh.fetch, readFile: async () => PEM, now: () => AGORA });
    const status = await checker.status();
    expect(status.configurado).toBe(false);
    expect(gh.chamadas).toEqual([]);
  });

  it("consulta o App com o JWT e lista as instalações com os repositórios de cada uma", async () => {
    const gh = githubFalso();
    const checker = createGitHubAppChecker({
      appId: 5685212,
      privateKeyPath: "/chave.pem",
      fetch: gh.fetch,
      readFile: async () => PEM,
      now: () => AGORA,
    });
    const status = await checker.status();
    expect(status).toMatchObject({
      configurado: true,
      app: { id: 5685212, slug: "fabrica-igor-sf", nome: "fabrica-igor-sf" },
      instalacoes: [
        {
          id: 180265101,
          conta: "IgorGuariroba",
          selecao: "selected",
          repositorios: ["IgorGuariroba/software-factories"],
        },
      ],
    });
    // /app usa o JWT; a leitura dos repositórios usa o token de instalação, não o JWT.
    expect(gh.chamadas[0]?.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    const leitura = gh.chamadas.find((c) => c.url.includes("/installation/repositories"));
    expect(leitura?.authorization).toBe("Bearer ghs_token_falso");
  });

  it("reaproveita a última consulta dentro do intervalo, sem nova chamada ao GitHub", async () => {
    const gh = githubFalso();
    let agora = AGORA;
    const checker = createGitHubAppChecker({
      appId: 5685212,
      privateKeyPath: "/chave.pem",
      fetch: gh.fetch,
      readFile: async () => PEM,
      now: () => agora,
      ttlMs: 60_000,
    });
    await checker.status();
    const depois = gh.chamadas.length;
    agora += 30_000;
    await checker.status();
    expect(gh.chamadas.length).toBe(depois);
    agora += 60_000;
    await checker.status();
    expect(gh.chamadas.length).toBeGreaterThan(depois);
  });

  it("falha do GitHub vira erro no status, sem vazar a chave nem o token", async () => {
    const gh = githubFalso({ appStatus: 401 });
    const checker = createGitHubAppChecker({
      appId: 5685212,
      privateKeyPath: "/chave.pem",
      fetch: gh.fetch,
      readFile: async () => PEM,
      now: () => AGORA,
    });
    const status = await checker.status();
    expect(status.erro).toBe("GitHub respondeu 401 em /app");
    expect(JSON.stringify(status)).not.toContain("BEGIN");
    expect(JSON.stringify(status)).not.toContain("ghs_token_falso");
  });

  it("chave que não pode ser lida vira erro, com o caminho do arquivo e sem a chave", async () => {
    const checker = createGitHubAppChecker({
      appId: 5685212,
      privateKeyPath: "/nao/existe.pem",
      fetch: githubFalso().fetch,
      readFile: async () => {
        throw new Error("ENOENT: no such file, open '/nao/existe.pem'");
      },
      now: () => AGORA,
    });
    const status = await checker.status();
    expect(status.configurado).toBe(true);
    expect(status.erro).toMatch(/ENOENT/);
  });
});
