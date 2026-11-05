import { describe, expect, it } from "vitest";
import { type AcliRunner, createJiraDemandSource } from "../src/jira-demand-source.js";
import { FakeAcli, type FakeJiraPerson } from "./fakes/fake-acli.js";

// O que é só do formato do Jira e não cabe no contrato da `DemandSource`, pela interface do adaptador
// (`createJiraDemandSource` com um `acli` falso). O comportamento comum às Fontes está em `demand-source.contract.ts`.

const me: FakeJiraPerson = { accountId: "acc-eu", emailAddress: "eu@exemplo.invalid", displayName: "Pessoa Eu" };
const other: FakeJiraPerson = {
  accountId: "acc-outra",
  emailAddress: "outra@exemplo.invalid",
  displayName: "Outra Pessoa",
};

/** Um Jira falso com um card meu e um de outra pessoa, e o adaptador configurado com `assignee`. */
function setup(assignee = me.accountId) {
  const acli = new FakeAcli(me);
  acli.issues = [
    { key: "PROJ-1", summary: "Implementar autenticação", status: "A Fazer", assignee: me },
    { key: "PROJ-2", summary: "Card de outra pessoa", status: "A Fazer", assignee: other },
  ];
  const source = createJiraDemandSource({ project: "PROJ", assignee, runner: acli.runner, env: {} });
  return { acli, source };
}

const withRunner = (runner: AcliRunner) =>
  createJiraDemandSource({ project: "PROJ", assignee: me.accountId, runner, env: {} });
const failing =
  (stderr: string): AcliRunner =>
  async () => ({ stdout: "", stderr, exitCode: 1 });
const printing =
  (stdout: string): AcliRunner =>
  async () => ({ stdout, stderr: "", exitCode: 0 });

describe("Fonte Jira: identidade das pessoas", () => {
  it("configurado pelo accountId, o usuário aparece como o accountId no card e nos comentários dele", async () => {
    const { acli, source } = setup(me.accountId);
    acli.addHumanComment("PROJ-1", me, "meu");

    expect((await source.listAssignedCards(me.accountId)).map((c) => c.assignee)).toEqual([me.accountId]);
    expect((await source.getCard("PROJ-1"))?.assignee).toBe(me.accountId);
    expect((await source.listComments("PROJ-1")).map((c) => c.author)).toEqual([me.accountId]);
  });

  it("outra pessoa aparece pelo accountId, mesmo com o usuário configurado pelo e-mail", async () => {
    const { acli, source } = setup(me.emailAddress);
    acli.addHumanComment("PROJ-1", me, "meu");
    acli.addHumanComment("PROJ-1", other, "dela");

    expect((await source.getCard("PROJ-2"))?.assignee).toBe(other.accountId);
    expect((await source.listComments("PROJ-1")).map((c) => [c.author, c.body])).toEqual([
      [me.emailAddress, "meu"],
      [other.accountId, "dela"],
    ]);
  });

  it("a busca traz o responsável real do card, não o pedido (ex.: card reatribuído entre a busca e a leitura)", async () => {
    const source = withRunner(
      printing(
        JSON.stringify([{ key: "PROJ-2", fields: { summary: "X", status: { name: "A Fazer" }, assignee: other } }]),
      ),
    );
    expect((await source.listAssignedCards(me.accountId)).map((c) => c.assignee)).toEqual([other.accountId]);
  });

  it("a menção sai no formato do Jira Cloud, com ou sem o prefixo accountid:", () => {
    const { source } = setup();
    expect(source.formatMention("user-456")).toBe("[~accountid:user-456]");
    expect(source.formatMention("accountid:user-456")).toBe("[~accountid:user-456]");
  });
});

describe("Fonte Jira: leituras", () => {
  it("o card inexistente com a mensagem do acli em português é ausente, não erro", async () => {
    expect(await withRunner(failing("Erro: o item PROJ-9 não existe")).getCard("PROJ-9")).toBeUndefined();
  });

  it("a falha do acli diz o card e a saída do acli", async () => {
    await expect(withRunner(failing("connection reset by peer")).getCard("PROJ-1")).rejects.toThrow(
      /PROJ-1.*connection reset by peer/s,
    );
  });

  it("informa a causa quando o executável acli não existe", async () => {
    const previous = process.env.ACLI_PATH;
    process.env.ACLI_PATH = "/caminho-inexistente-fabrica/acli";
    try {
      const source = createJiraDemandSource({ project: "PROJ", assignee: me.accountId });
      await expect(source.getCard("PROJ-1")).rejects.toThrow(/PROJ-1.*ENOENT/s);
    } finally {
      if (previous === undefined) delete process.env.ACLI_PATH;
      else process.env.ACLI_PATH = previous;
    }
  });

  it("não inclui o corpo privado na falha de execução do acli", async () => {
    const previous = process.env.ACLI_PATH;
    process.env.ACLI_PATH = "/usr/bin/false";
    try {
      const source = createJiraDemandSource({ project: "PROJ", assignee: me.accountId });
      const error = await source.addComment("PROJ-1", "conteúdo confidencial do card").catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain("conteúdo confidencial do card");
      expect(String(error)).toMatch(/PROJ-1.*1/s);
    } finally {
      if (previous === undefined) delete process.env.ACLI_PATH;
      else process.env.ACLI_PATH = previous;
    }
  });

  it("não registra o corpo mesmo se o acli o ecoar em stderr", async () => {
    const source = withRunner(failing("falha: texto confidencial"));
    const error = await source.editComment("PROJ-1", "123", "texto confidencial").catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("texto confidencial");
  });

  it("comentários truncados pelo Jira (total maior que os recebidos) lançam erro em vez de uma lista parcial", async () => {
    const partial = {
      key: "PROJ-1",
      fields: { comment: { comments: [{ id: "1", author: other, body: "a" }], total: 2, maxResults: 1, startAt: 0 } },
    };
    await expect(withRunner(printing(JSON.stringify(partial))).listComments("PROJ-1")).rejects.toThrow(
      /PROJ-1.*1 de 2/s,
    );
  });

  it("comentários de um card do projeto que não existe lançam erro", async () => {
    const { source } = setup();
    await expect(source.listComments("PROJ-999")).rejects.toThrow(/PROJ-999/);
  });
});

describe("Fonte Jira: criação de comentário", () => {
  it("aceita o id do comentário criado em qualquer formato de resposta do acli", async () => {
    for (const stdout of [{ id: "77" }, { comment: { id: 77 } }, [{ id: "77" }], { data: { id: "77" } }]) {
      expect(await withRunner(printing(JSON.stringify(stdout))).addComment("PROJ-1", "x")).toEqual({ id: "77" });
    }
  });

  it("sem id na resposta, devolve o meu comentário mais recente que começa com a primeira linha do corpo", async () => {
    const { acli, source } = setup(me.emailAddress);
    acli.createReturnsId = false;
    acli.addHumanComment("PROJ-1", other, "Título\n\nde outra pessoa");
    const older = acli.addHumanComment("PROJ-1", me, "Título\n\nantigo");

    const { id } = await source.addComment("PROJ-1", "Título\n\nnovo");

    expect(id).not.toBe(older);
    expect((await source.listComments("PROJ-1")).find((c) => c.id === id)?.body).toBe("Título\n\nnovo");
  });

  it("sem id na resposta e sem comentário correspondente, lança erro em vez de inventar um id", async () => {
    const source = withRunner(async (args) =>
      args[2] === "view"
        ? printing(JSON.stringify({ key: "PROJ-1", fields: { comment: { comments: [], total: 0 } } }))(args)
        : printing("Comment 123 added")(args),
    );
    await expect(source.addComment("PROJ-1", "Corpo")).rejects.toThrow(/id do comentário.*PROJ-1/s);
  });

  it("a falha do acli ao comentar lança erro com o card", async () => {
    await expect(withRunner(failing("sem permissão")).addComment("PROJ-1", "x")).rejects.toThrow(
      /PROJ-1.*detalhes omitidos/s,
    );
  });
});

describe("Fonte Jira: conteúdo dos anexos de texto com credenciais", () => {
  const creds = { ATLASSIAN_EMAIL: "eu@exemplo.invalid", ATLASSIAN_API_TOKEN: "token-super-secreto" };
  const basic = Buffer.from("eu@exemplo.invalid:token-super-secreto").toString("base64");

  function withAttachments(fetchImpl: typeof fetch, timeoutMs?: number) {
    const acli = new FakeAcli(me);
    acli.issues = [
      {
        key: "PROJ-1",
        summary: "x",
        status: "A Fazer",
        assignee: me,
        attachments: [
          {
            id: "1",
            filename: "especificacao.md",
            mimeType: "text/markdown",
            size: 1,
            content: "https://exemplo.invalid/a/1",
          },
          { id: "2", filename: "print.png", mimeType: "image/png", size: 1, content: "https://exemplo.invalid/a/2" },
        ],
      },
    ];
    return createJiraDemandSource({
      project: "PROJ",
      assignee: me.accountId,
      runner: acli.runner,
      env: creds,
      fetch: fetchImpl,
      timeoutMs,
    });
  }

  it("baixa o conteúdo com autenticação básica", async () => {
    const requests: { url: string; auth: string | null }[] = [];
    const source = withAttachments(async (url, init) => {
      requests.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return new Response("# Especificação");
    });

    expect(await source.listTextAttachments("PROJ-1")).toEqual([
      { name: "especificacao.md", content: "# Especificação" },
    ]);
    expect(requests).toEqual([{ url: "https://exemplo.invalid/a/1", auth: `Basic ${basic}` }]);
  });

  it("interrompe download de anexo que não responde e informa o anexo", async () => {
    const source = withAttachments(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("prazo excedido")), { once: true });
        }),
      20,
    );
    await expect(source.listTextAttachments("PROJ-1")).rejects.toThrow(/especificacao\.md.*prazo excedido/);
  });

  it("HTTP não-ok ou erro de rede falham a leitura, dizendo o anexo e sem expor o token", async () => {
    const notOk = withAttachments(async () => new Response("proibido", { status: 403 }));
    const network = withAttachments(async () => {
      throw new TypeError("fetch failed");
    });
    for (const source of [notOk, network]) {
      const err = await source.listTextAttachments("PROJ-1").then(
        () => undefined,
        (e: unknown) => e as Error,
      );
      expect(err?.message).toMatch(/especificacao\.md/);
      expect(err?.message).not.toContain("token-super-secreto");
      expect(err?.message).not.toContain(basic);
    }
    await expect(notOk.listTextAttachments("PROJ-1")).rejects.toThrow(/403/);
  });
});
