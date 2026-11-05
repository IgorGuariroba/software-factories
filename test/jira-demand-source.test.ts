import { describe, expect, it } from "vitest";
import {
  type AcliRunner,
  adfToText,
  createHttpAttachmentReader,
  createJiraDemandSource,
} from "../src/jira-demand-source.js";
import { FakeAcli, type FakeJiraPerson } from "./fakes/fake-acli.js";

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
    {
      key: "PROJ-1",
      summary: "Implementar autenticação",
      status: "A Fazer",
      assignee: me,
      description: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: "Descrição com ADF" }] }],
      },
    },
    { key: "PROJ-2", summary: "Card de outra pessoa", status: "A Fazer", assignee: other },
  ];
  const source = createJiraDemandSource({ project: "PROJ", assignee, runner: acli.runner });
  return { acli, source };
}

const failing =
  (stderr: string, stdout = ""): AcliRunner =>
  async () => ({ stdout, stderr, exitCode: 1 });
const printing =
  (stdout: string): AcliRunner =>
  async () => ({ stdout, stderr: "", exitCode: 0 });

describe("JiraDemandSource", () => {
  it("listAssignedCards consulta via JQL com --paginate e mapeia campos e descrição ADF", async () => {
    const { acli, source } = setup();

    const cards = await source.listAssignedCards(me.accountId);

    expect(acli.calls[0]).toEqual([
      "jira",
      "workitem",
      "search",
      "--jql",
      'project = "PROJ" AND assignee = "acc-eu"',
      "--fields",
      "key,summary,status,assignee,description",
      "--json",
      "--paginate",
    ]);
    expect(cards).toEqual([
      {
        key: "PROJ-1",
        title: "Implementar autenticação",
        status: "A Fazer",
        assignee: "acc-eu",
        description: "Descrição com ADF",
      },
    ]);
  });

  it("listAssignedCards devolve todos os cards, mesmo mais de 50", async () => {
    const { acli, source } = setup();
    acli.issues = Array.from({ length: 120 }, (_, i) => ({
      key: `PROJ-${i + 1}`,
      summary: `Card ${i + 1}`,
      status: "A Fazer",
      assignee: me,
    }));

    expect(await source.listAssignedCards(me.accountId)).toHaveLength(120);
  });

  describe("identidade", () => {
    it("card.assignee é o valor configurado quando a pessoa é o usuário (por e-mail ou accountId)", async () => {
      for (const configured of [me.emailAddress, me.accountId]) {
        const { source } = setup(configured);
        expect((await source.listAssignedCards(configured)).map((c) => c.assignee)).toEqual([configured]);
        expect((await source.getCard("PROJ-1"))?.assignee).toBe(configured);
      }
    });

    it("card.assignee de outra pessoa é o accountId dela", async () => {
      const { source } = setup(me.emailAddress);
      expect((await source.getCard("PROJ-2"))?.assignee).toBe(other.accountId);
    });

    it("listAssignedCards usa o assignee real do card, não o parâmetro", async () => {
      // O Jira devolveu um card de outra pessoa (ex.: reatribuído entre a busca e a leitura).
      const cards = await createJiraDemandSource({
        project: "PROJ",
        assignee: me.emailAddress,
        runner: printing(
          JSON.stringify([{ key: "PROJ-2", fields: { summary: "X", status: { name: "A Fazer" }, assignee: other } }]),
        ),
      }).listAssignedCards(me.emailAddress);
      expect(cards.map((c) => c.assignee)).toEqual([other.accountId]);
    });

    it("comment.author é o valor configurado nos meus comentários e o accountId nos de outras pessoas", async () => {
      const { acli, source } = setup(me.emailAddress);
      acli.addHumanComment("PROJ-1", me, "meu");
      acli.addHumanComment("PROJ-1", other, "dela");

      const comments = await source.listComments("PROJ-1");

      expect(comments.map((c) => [c.author, c.body])).toEqual([
        [me.emailAddress, "meu"],
        [other.accountId, "dela"],
      ]);
    });
  });

  describe("getCard", () => {
    it("devolve undefined para card inexistente ou de outro projeto (sem chamar o acli)", async () => {
      const { acli, source } = setup();
      expect(await source.getCard("PROJ-999")).toBeUndefined();
      const calls = acli.calls.length;
      expect(await source.getCard("OUTRO-1")).toBeUndefined();
      expect(acli.calls).toHaveLength(calls);
    });

    it("reconhece a mensagem de card inexistente em português", async () => {
      const source = createJiraDemandSource({
        project: "PROJ",
        assignee: "acc-eu",
        runner: failing("Erro: o item PROJ-9 não existe"),
      });
      expect(await source.getCard("PROJ-9")).toBeUndefined();
    });

    it("lança erro com comando, card e stderr quando o acli falha por outro motivo", async () => {
      const source = createJiraDemandSource({
        project: "PROJ",
        assignee: "acc-eu",
        runner: failing("connection reset by peer"),
      });
      await expect(source.getCard("PROJ-1")).rejects.toThrow(/workitem view.*PROJ-1.*connection reset by peer/s);
    });

    it("lança erro quando o acli devolve JSON inválido", async () => {
      const source = createJiraDemandSource({ project: "PROJ", assignee: "acc-eu", runner: printing("<html>") });
      await expect(source.getCard("PROJ-1")).rejects.toThrow(/JSON inválido.*PROJ-1/s);
    });
  });

  describe("falhas de leitura nunca viram lista vazia", () => {
    const cases: [string, (s: ReturnType<typeof createJiraDemandSource>) => Promise<unknown>][] = [
      ["listAssignedCards", (s) => s.listAssignedCards("acc-eu")],
      ["listComments", (s) => s.listComments("PROJ-1")],
      ["listTextAttachments", (s) => s.listTextAttachments("PROJ-1")],
    ];
    for (const [name, call] of cases) {
      it(`${name} lança erro quando o acli sai com erro`, async () => {
        const source = createJiraDemandSource({ project: "PROJ", assignee: "acc-eu", runner: failing("timeout") });
        await expect(call(source)).rejects.toThrow(/acli jira workitem.*timeout/s);
      });

      it(`${name} lança erro quando o acli devolve JSON inválido`, async () => {
        const source = createJiraDemandSource({ project: "PROJ", assignee: "acc-eu", runner: printing("não é json") });
        await expect(call(source)).rejects.toThrow(/JSON inválido/);
      });
    }

    it("listComments e listTextAttachments de card de outro projeto devolvem [] sem chamar o acli", async () => {
      const { acli, source } = setup();
      expect(await source.listComments("OUTRO-1")).toEqual([]);
      expect(await source.listTextAttachments("OUTRO-1")).toEqual([]);
      expect(acli.calls).toHaveLength(0);
    });
  });

  describe("listComments", () => {
    it("lê via view --fields comment e converte o corpo ADF em texto", async () => {
      const { acli, source } = setup();
      acli.addHumanComment("PROJ-1", other, "Linha 1\n\nLinha 3");

      const comments = await source.listComments("PROJ-1");

      expect(acli.calls.at(-1)).toEqual(["jira", "workitem", "view", "PROJ-1", "--fields", "comment", "--json"]);
      expect(comments).toEqual([{ id: expect.any(String), author: other.accountId, body: "Linha 1\n\nLinha 3" }]);
    });

    it("lança erro em vez de devolver uma lista parcial quando total > recebidos", async () => {
      const partial = {
        key: "PROJ-1",
        fields: {
          comment: {
            comments: [{ id: "1", author: other, body: "a" }],
            total: 2,
            maxResults: 1,
            startAt: 0,
          },
        },
      };
      const source = createJiraDemandSource({
        project: "PROJ",
        assignee: "acc-eu",
        runner: printing(JSON.stringify(partial)),
      });
      await expect(source.listComments("PROJ-1")).rejects.toThrow(/PROJ-1.*1 de 2/s);
    });

    it("lança erro quando o card não existe", async () => {
      const { source } = setup();
      await expect(source.listComments("PROJ-999")).rejects.toThrow(/PROJ-999/);
    });
  });

  describe("addComment", () => {
    it("cria via acli e devolve o id do JSON da resposta", async () => {
      const { acli, source } = setup();

      const { id } = await source.addComment("PROJ-1", "Novo comentário");

      expect(acli.calls[0]).toEqual([
        "jira",
        "workitem",
        "comment",
        "create",
        "--key",
        "PROJ-1",
        "--body",
        "Novo comentário",
        "--json",
      ]);
      expect((await source.listComments("PROJ-1")).find((c) => c.id === id)?.body).toBe("Novo comentário");
    });

    it("aceita o id aninhado ou numérico na resposta", async () => {
      for (const stdout of [{ comment: { id: 77 } }, [{ id: "77" }], { data: { id: "77" } }]) {
        const source = createJiraDemandSource({
          project: "PROJ",
          assignee: "acc-eu",
          runner: printing(JSON.stringify(stdout)),
        });
        expect(await source.addComment("PROJ-1", "x")).toEqual({ id: "77" });
      }
    });

    it("sem id na resposta, acha o meu comentário mais recente que começa com a primeira linha do corpo", async () => {
      const { acli, source } = setup(me.emailAddress);
      acli.createReturnsId = false;
      acli.addHumanComment("PROJ-1", other, "Título\n\nde outra pessoa");
      const older = acli.addHumanComment("PROJ-1", me, "Título\n\nantigo");

      const { id } = await source.addComment("PROJ-1", "Título\n\nnovo");

      expect(id).not.toBe(older);
      expect((await source.listComments("PROJ-1")).find((c) => c.id === id)?.body).toBe("Título\n\nnovo");
    });

    it("sem id na resposta e sem comentário correspondente, lança erro em vez de inventar um id", async () => {
      const source = createJiraDemandSource({
        project: "PROJ",
        assignee: "acc-eu",
        runner: async (args) =>
          args[2] === "view"
            ? {
                stdout: JSON.stringify({ key: "PROJ-1", fields: { comment: { comments: [], total: 0 } } }),
                stderr: "",
                exitCode: 0,
              }
            : { stdout: "Comment 123 added", stderr: "", exitCode: 0 },
      });
      await expect(source.addComment("PROJ-1", "Corpo")).rejects.toThrow(/id do comentário.*PROJ-1/s);
    });

    it("lança erro quando o acli falha", async () => {
      const source = createJiraDemandSource({ project: "PROJ", assignee: "acc-eu", runner: failing("sem permissão") });
      await expect(source.addComment("PROJ-1", "x")).rejects.toThrow(/PROJ-1.*sem permissão/s);
    });
  });

  it("editComment atualiza o comentário via acli", async () => {
    const { acli, source } = setup();
    const { id } = await source.addComment("PROJ-1", "antes");

    await source.editComment("PROJ-1", id, "Comentário alterado");

    expect(acli.calls.at(-1)).toEqual([
      "jira",
      "workitem",
      "comment",
      "update",
      "--key",
      "PROJ-1",
      "--id",
      id,
      "--body",
      "Comentário alterado",
    ]);
    expect((await source.listComments("PROJ-1")).find((c) => c.id === id)?.body).toBe("Comentário alterado");
  });

  it("transition transiciona com a flag --yes", async () => {
    const { acli, source } = setup();
    await source.transition("PROJ-1", "Em Andamento");
    expect(acli.calls.at(-1)).toEqual([
      "jira",
      "workitem",
      "transition",
      "--key",
      "PROJ-1",
      "--status",
      "Em Andamento",
      "--yes",
    ]);
    expect((await source.getCard("PROJ-1"))?.status).toBe("Em Andamento");
  });

  it("formatMention formata menção padrão Jira Cloud", () => {
    const { source } = setup();
    expect(source.formatMention("user-456")).toBe("[~accountid:user-456]");
    expect(source.formatMention("accountid:user-456")).toBe("[~accountid:user-456]");
  });

  describe("anexos", () => {
    const attachments = [
      {
        id: "1",
        filename: "especificacao.md",
        mimeType: "text/markdown",
        size: 1,
        content: "https://exemplo.invalid/a/1",
      },
      { id: "2", filename: "print.png", mimeType: "image/png", size: 1, content: "https://exemplo.invalid/a/2" },
      { id: "3", filename: "dados.csv", mimeType: "text/csv", size: 1, content: "https://exemplo.invalid/a/3" },
    ];

    it("listTextAttachments filtra binários e lê o conteúdo dos anexos de texto", async () => {
      const acli = new FakeAcli(me);
      acli.issues = [{ key: "PROJ-1", summary: "x", status: "A Fazer", assignee: me, attachments }];
      const source = createJiraDemandSource({
        project: "PROJ",
        assignee: "acc-eu",
        runner: acli.runner,
        readAttachment: async (att) => `conteúdo de ${att.filename} em ${att.contentUrl}`,
      });

      expect(await source.listTextAttachments("PROJ-1")).toEqual([
        { name: "especificacao.md", content: "conteúdo de especificacao.md em https://exemplo.invalid/a/1" },
        { name: "dados.csv", content: "conteúdo de dados.csv em https://exemplo.invalid/a/3" },
      ]);
      expect(acli.calls[0]).toEqual(["jira", "workitem", "view", "PROJ-1", "--fields", "attachment", "--json"]);
    });

    const info = { id: "1", filename: "especificacao.md", contentUrl: "https://exemplo.invalid/a/1" };
    const creds = { ATLASSIAN_EMAIL: "eu@exemplo.invalid", ATLASSIAN_API_TOKEN: "token-super-secreto" };

    it("sem credencial, o conteúdo diz explicitamente que não foi lido", async () => {
      let fetched = false;
      const read = createHttpAttachmentReader({
        env: {},
        fetch: async () => {
          fetched = true;
          return new Response("x");
        },
      });
      expect(await read(info)).toBe("[conteúdo não lido: defina ATLASSIAN_EMAIL e ATLASSIAN_API_TOKEN]");
      expect(fetched).toBe(false);
    });

    it("com credencial, baixa com autenticação básica", async () => {
      let auth: string | null = null;
      const read = createHttpAttachmentReader({
        env: creds,
        fetch: async (_url, init) => {
          auth = new Headers(init?.headers).get("authorization");
          return new Response("# Especificação");
        },
      });
      expect(await read(info)).toBe("# Especificação");
      expect(auth).toBe(`Basic ${Buffer.from("eu@exemplo.invalid:token-super-secreto").toString("base64")}`);
    });

    it("com credencial, HTTP não-ok ou erro de rede lançam erro sem expor o token", async () => {
      const notOk = createHttpAttachmentReader({
        env: creds,
        fetch: async () => new Response("proibido", { status: 403 }),
      });
      const network = createHttpAttachmentReader({
        env: creds,
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      });
      for (const read of [notOk, network]) {
        const err = await read(info).then(
          () => undefined,
          (e: unknown) => e as Error,
        );
        expect(err?.message).toMatch(/especificacao\.md/);
        expect(err?.message).not.toContain("token-super-secreto");
        expect(err?.message).not.toContain(Buffer.from("eu@exemplo.invalid:token-super-secreto").toString("base64"));
      }
      await expect(notOk(info)).rejects.toThrow(/403/);
    });
  });

  describe("adfToText", () => {
    it("quebra linha em itens de lista, citações e réguas", () => {
      const doc = {
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Introdução" }] },
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Primeiro" }] }] },
              { type: "listItem", content: [{ type: "text", text: "Segundo" }] },
            ],
          },
          { type: "rule" },
          { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Nota" }] }] },
          { type: "paragraph", content: [{ type: "text", text: "Fim" }] },
        ],
      };

      expect(adfToText(doc).trim()).toBe("Introdução\nPrimeiro\nSegundo\n\nNota\nFim");
    });

    it("parágrafo vazio sem content vira linha em branco", () => {
      const doc = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Título" }] },
          { type: "paragraph" },
          { type: "paragraph", content: [{ type: "text", text: "Corpo" }] },
        ],
      };
      expect(adfToText(doc).trim()).toBe("Título\n\nCorpo");
    });
  });
});
