import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGitHubAppChecker } from "../src/github-app.js";
import { falhaDeRede, falhaDeResposta } from "../src/github-falhas.js";

const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();
const AGORA = Date.UTC(2026, 10, 9, 12, 0, 0);

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Checker com uma API que responde `resposta(caminho)` em cada chamada. */
function checkerCom(resposta: (caminho: string) => Response | Promise<Response>) {
  return createGitHubAppChecker({
    appId: 5685212,
    privateKeyPath: "/chave.pem",
    readFile: async () => PEM,
    now: () => AGORA,
    fetch: (async (url: string) => resposta(new URL(url).pathname)) as unknown as typeof fetch,
  });
}

describe("falhaDeResposta: a mensagem de cada erro do GitHub", () => {
  it("403 sem sinal de limite é falta de permissão, e diz qual permissão olhar", () => {
    const msg = falhaDeResposta({ status: 403, caminho: "/repos/d/r/issues", agora: AGORA });
    expect(msg).toContain("não tem permissão para /repos/d/r/issues");
    expect(msg).toContain("Issues");
  });

  it("403 com remaining zero é limite, com a hora em que libera (reset em segundos)", () => {
    const reset = String(Math.floor(AGORA / 1000) + 600);
    const msg = falhaDeResposta({
      status: 403,
      caminho: "/repos/d/r/issues",
      agora: AGORA,
      cabecalhos: { remaining: "0", reset },
    });
    expect(msg).toMatch(/^limite de requisições da API do GitHub atingido; libera às /);
  });

  it("429 é limite; retry-after vale quando não há reset", () => {
    expect(falhaDeResposta({ status: 429, caminho: "/x", agora: AGORA })).toMatch(/limite de requisições/);
    const msg = falhaDeResposta({ status: 429, caminho: "/x", agora: AGORA, cabecalhos: { retryAfter: "60" } });
    expect(msg).toMatch(/libera às/);
  });

  it("404 ao trocar o token da instalação é instalação removida ou suspensa", () => {
    expect(falhaDeResposta({ status: 404, caminho: "/app/installations/1/access_tokens", agora: AGORA })).toBe(
      "a instalação do App foi removida ou suspensa no GitHub",
    );
  });

  it("401 mantém a mensagem genérica, como antes", () => {
    expect(falhaDeResposta({ status: 401, caminho: "/app", agora: AGORA })).toBe("GitHub respondeu 401 em /app");
  });

  it("falha de rede e tempo esgotado têm mensagens próprias, sem a URL do erro", () => {
    expect(falhaDeRede(new TypeError("fetch failed"))).toBe("falha de rede ao falar com o GitHub");
    const tempo = new Error("The operation was aborted due to timeout");
    tempo.name = "TimeoutError";
    expect(falhaDeRede(tempo)).toBe("o GitHub não respondeu a tempo");
  });
});

describe("createGitHubAppChecker: as falhas chegam ao painel com a mensagem certa", () => {
  it("instalação revogada aparece como instalação removida, e o status não traz token", async () => {
    const checker = checkerCom((caminho) => {
      if (caminho === "/app") return json({ id: 1, slug: "x", name: "x" });
      if (caminho === "/app/installations")
        return json([{ id: 9, account: { login: "d" }, repository_selection: "all" }]);
      return json({ message: "Not Found" }, 404);
    });
    const status = await checker.status();
    expect(status.erro).toBe("a instalação do App foi removida ou suspensa no GitHub");
  });

  it("falta de permissão na leitura de issues chega como permissão", async () => {
    const checker = checkerCom((caminho) => {
      if (caminho === "/app") return json({ id: 1, slug: "x", name: "x" });
      if (caminho === "/app/installations")
        return json([{ id: 9, account: { login: "d" }, repository_selection: "all" }]);
      if (caminho === "/app/installations/9/access_tokens") return json({ token: "t" });
      if (caminho === "/installation/repositories") return json({ repositories: [] });
      return json({ message: "Forbidden" }, 403);
    });
    await expect(checker.issuesAbertas("d/r", 9)).rejects.toThrow(/não tem permissão para \/repos\/d\/r\/issues/);
  });

  it("limite da API nas issues chega com a hora de liberação", async () => {
    const reset = String(Math.floor(AGORA / 1000) + 900);
    const checker = checkerCom((caminho) => {
      if (caminho === "/app/installations/9/access_tokens") return json({ token: "t" });
      return json({ message: "API rate limit" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset });
    });
    await expect(checker.issuesAbertas("d/r", 9)).rejects.toThrow(/limite de requisições da API do GitHub atingido/);
  });

  it("queda de rede não vira erro cru: a mensagem diz que é rede", async () => {
    const checker = createGitHubAppChecker({
      appId: 5685212,
      privateKeyPath: "/chave.pem",
      readFile: async () => PEM,
      now: () => AGORA,
      fetch: (async () => {
        throw new TypeError("fetch failed: getaddrinfo ENOTFOUND api.github.com");
      }) as unknown as typeof fetch,
    });
    const status = await checker.status();
    expect(status.erro).toBe("falha de rede ao falar com o GitHub");
    expect(JSON.stringify(status)).not.toContain("ENOTFOUND");
  });
});
