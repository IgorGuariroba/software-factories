import { describe, expect, it } from "vitest";
import { conferirEscolhasPessoas, listarPessoasGitlab, listarPessoasJira } from "../src/pessoas-fonte.js";

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

describe("listarPessoasJira: usuários atribuíveis ao projeto, sem contas de serviço", () => {
  it("manda o projeto e a autenticação básica, e devolve só as pessoas ativas, pelo accountId", async () => {
    let url = "";
    let auth: string | null = null;
    const fetchFalso = (async (u: string, init?: RequestInit) => {
      url = u;
      auth = new Headers(init?.headers).get("Authorization");
      return resposta([
        { accountId: "acc-1", displayName: "Ana", accountType: "atlassian", active: true },
        { accountId: "acc-bot", displayName: "Robô", accountType: "app", active: true },
        { accountId: "acc-2", displayName: "Bruno", accountType: "atlassian", active: false },
      ]);
    }) as unknown as typeof fetch;
    const pessoas = await listarPessoasJira({
      baseUrl: "https://empresa.atlassian.net/",
      email: "dev@empresa.com",
      token: "segredo",
      projeto: "APP",
      fetch: fetchFalso,
    });
    expect(url).toContain("https://empresa.atlassian.net/rest/api/3/user/assignable/search?project=APP");
    expect(auth).toBe(`Basic ${Buffer.from("dev@empresa.com:segredo").toString("base64")}`);
    expect(pessoas).toEqual([{ id: "acc-1", nome: "Ana" }]);
  });

  it("Jira que responde 401 lança erro em português, sem o token", async () => {
    const fetchFalso = (async () => resposta({ message: "x" }, 401)) as unknown as typeof fetch;
    const erro = await listarPessoasJira({
      baseUrl: "https://empresa.atlassian.net",
      email: "dev@empresa.com",
      token: "segredo-do-cofre",
      projeto: "APP",
      fetch: fetchFalso,
    }).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toContain("não foi possível consultar as pessoas na Fonte Jira");
    expect((erro as Error).message).toContain("HTTP 401");
    expect((erro as Error).message).not.toContain("segredo-do-cofre");
  });
});

describe("listarPessoasGitlab: membros do projeto, por todas as páginas", () => {
  it("segue as páginas até a última, com o username como identificador", async () => {
    const primeira = Array.from({ length: 100 }, (_, i) => ({ id: i, username: `u${i}`, name: `Pessoa ${i}` }));
    const fetchFalso = (async (u: string) => {
      const pagina = new URL(u).searchParams.get("page");
      return resposta(pagina === "1" ? primeira : [{ id: 999, username: "ultima", name: "Última" }]);
    }) as unknown as typeof fetch;
    const pessoas = await listarPessoasGitlab({ host: "gitlab.com", caminho: "g/p", token: "t", fetch: fetchFalso });
    expect(pessoas).toHaveLength(101);
    expect(pessoas[100]).toEqual({ id: "ultima", nome: "Última" });
  });

  it("falha de rede vira erro com o servidor e a causa", async () => {
    const fetchFalso = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(
      listarPessoasGitlab({ host: "gitlab.empresa.com", caminho: "g/p", token: "t", fetch: fetchFalso }),
    ).rejects.toThrow(
      "não foi possível consultar as pessoas na Fonte GitLab Issues (g/p em gitlab.empresa.com): fetch failed",
    );
  });
});

describe("conferirEscolhasPessoas: a escolha tem de existir na lista da Fonte", () => {
  const lista = [{ id: "ana", nome: "Ana" }];

  it("sem escolha, ou com escolhas que existem, não há erro", () => {
    expect(conferirEscolhasPessoas(undefined, lista, "gitlab")).toBeUndefined();
    expect(conferirEscolhasPessoas({}, lista, "gitlab")).toBeUndefined();
    expect(conferirEscolhasPessoas({ po: "ana", techLead: "ana" }, lista, "gitlab")).toBeUndefined();
  });

  it("escolha que a Fonte não conhece aponta o papel e a Fonte", () => {
    expect(conferirEscolhasPessoas({ techLead: "ze" }, lista, "jira")).toBe(
      "tech lead: ze não existe na Fonte Jira; escolha uma pessoa da lista",
    );
  });
});
