import { describe, expect, it } from "vitest";
import { createEffectWriter } from "../src/effect-writer.js";
import { EventLog } from "../src/events.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";
import { MemoryRetroSink } from "./fakes/memory-retro-sink.js";
import { PO, testProjectConfig, USER } from "./harness.js";

function setup(opts: { dryRun?: boolean } = {}) {
  const source = new MemoryDemandSource([{ key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER }]);
  const events = new EventLog();
  const writer = createEffectWriter({
    config: testProjectConfig({ dryRun: opts.dryRun ?? false }),
    source,
    events,
    transitionLimit: "in_progress",
  });
  return { source, events, writer };
}

describe("escritor de efeitos", () => {
  it("comenta no card com o prefixo de automação e registra a escrita", async () => {
    const { source, events, writer } = setup();

    await writer.comment("PROJ-1", "Assumindo este card.");

    expect(source.commentsOf("PROJ-1").map((c) => c.body)).toEqual(["Assumindo este card.\n\n*mensagem automatizada*"]);
    expect(events.list()).toMatchObject([
      { type: "write", project: "exemplo", target: "PROJ-1", action: "comment", dryRun: false },
    ]);
  });

  it("no dry-run não escreve na Fonte, mas registra destino e conteúdo", async () => {
    const { source, events, writer } = setup({ dryRun: true });

    await writer.comment("PROJ-1", "Assumindo este card.");
    await writer.transition("PROJ-1", "in_progress");

    expect(source.commentsOf("PROJ-1")).toEqual([]);
    expect(source.cards[0]?.status).toBe("A Fazer");
    expect(events.list()).toMatchObject([
      {
        type: "write",
        target: "PROJ-1",
        action: "comment",
        content: "Assumindo este card.\n\n*mensagem automatizada*",
        dryRun: true,
      },
      { type: "write", target: "PROJ-1", action: "transition", content: "Em Andamento", dryRun: true },
    ]);
  });

  it("no dry-run, uma escrita idempotente já registrada no log não é registrada de novo, nem por um escritor novo", async () => {
    const { events, writer } = setup({ dryRun: true });
    // O escritor de depois de um reinício: outro objeto, sobre o mesmo log de eventos.
    const again = createEffectWriter({
      config: testProjectConfig({ dryRun: true }),
      source: new MemoryDemandSource([{ key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER }]),
      events,
      transitionLimit: "in_progress",
    });

    for (const w of [writer, again]) {
      await w.commentOnce("PROJ-1", "Assumindo este card.");
      await w.transition("PROJ-1", "in_progress");
      await w.upsertComment("PROJ-1", "SPEC", "Entregar o CSV.");
      await w.mention("PROJ-1", PO, "Pergunta 1: qual o separador?");
    }
    await writer.upsertComment("PROJ-1", "SPEC", "Entregar o CSV com cabeçalho.");
    // `comment` não é idempotente: cada chamada é uma escrita.
    await writer.comment("PROJ-1", "Oi.");
    await again.comment("PROJ-1", "Oi.");

    expect(events.list().map((e) => (e.type === "write" ? `${e.action}: ${e.content}` : e.type))).toEqual([
      "comment: Assumindo este card.\n\n*mensagem automatizada*",
      "transition: Em Andamento",
      "comment: SPEC\n\nEntregar o CSV.\n\n*mensagem automatizada*",
      "mention: Pergunta 1: qual o separador?\n\n*mensagem automatizada*",
      "comment: SPEC\n\nEntregar o CSV com cabeçalho.\n\n*mensagem automatizada*",
      "comment: Oi.\n\n*mensagem automatizada*",
      "comment: Oi.\n\n*mensagem automatizada*",
    ]);
  });

  describe("guardrails", () => {
    it("bloqueia escrita em card que não é do usuário e avisa por evento", async () => {
      const { source, events, writer } = setup();
      source.cards.push({ key: "PROJ-2", title: "alheio", status: "A Fazer", assignee: "maria" });

      await expect(writer.comment("PROJ-2", "oi")).rejects.toThrow(/guardrail/i);
      await expect(writer.transition("PROJ-2", "in_progress")).rejects.toThrow(/guardrail/i);

      expect(source.commentsOf("PROJ-2")).toEqual([]);
      expect(source.cards[1]?.status).toBe("A Fazer");
      expect(events.list()).toMatchObject([
        { type: "blocked", target: "PROJ-2", action: "comment", reason: expect.stringMatching(/maria/) },
        { type: "blocked", target: "PROJ-2", action: "transition" },
      ]);
    });

    it("bloqueia escrita em card que não existe no projeto", async () => {
      const { events, writer } = setup();

      await expect(writer.comment("OUTRO-9", "oi")).rejects.toThrow(/guardrail/i);
      expect(events.list()).toMatchObject([{ type: "blocked", target: "OUTRO-9" }]);
    });

    it("bloqueia transição além do limite do marco e para o backlog", async () => {
      const { source, events, writer } = setup();

      await expect(writer.transition("PROJ-1", "waiting_test")).rejects.toThrow(/guardrail/i);
      await expect(writer.transition("PROJ-1", "backlog")).rejects.toThrow(/guardrail/i);

      expect(source.cards[0]?.status).toBe("A Fazer");
      expect(events.list().map((e) => e.type)).toEqual(["blocked", "blocked"]);
    });

    it("bloqueia a transição se o card não está mais no estado esperado", async () => {
      const { source, events, writer } = setup();
      await writer.comment("PROJ-1", "Assumindo este card.");
      // Uma pessoa move o card enquanto a fábrica assumia.
      if (source.cards[0]) source.cards[0].status = "Aguardando Teste";

      await expect(writer.transition("PROJ-1", "in_progress", { from: "todo" })).rejects.toThrow(/guardrail/i);

      expect(source.cards[0]?.status).toBe("Aguardando Teste");
      expect(events.list().at(-1)).toMatchObject({ type: "blocked", action: "transition" });
    });

    it("edita só os comentários da própria fábrica", async () => {
      const { source, events, writer } = setup();
      const own = await writer.comment("PROJ-1", "SPEC v1");
      const human = source.humanComment("PROJ-1", "maria", "comentário da maria");
      const mine = source.humanComment("PROJ-1", USER, "comentário meu, escrito à mão");

      await writer.editComment("PROJ-1", own.id, "SPEC v2");
      await expect(writer.editComment("PROJ-1", human.id, "x")).rejects.toThrow(/guardrail/i);
      await expect(writer.editComment("PROJ-1", mine.id, "x")).rejects.toThrow(/guardrail/i);

      expect(source.commentsOf("PROJ-1").map((c) => c.body)).toEqual([
        "SPEC v2\n\n*mensagem automatizada*",
        "comentário da maria",
        "comentário meu, escrito à mão",
      ]);
      expect(events.list().filter((e) => e.type === "blocked")).toHaveLength(2);
    });
  });

  describe("filtro de segredos", () => {
    // Tokens montados em tempo de execução para o gitleaks do repositório não acusá-los.
    const fakeSecrets = {
      github: `gh${"p"}_${"A1b2".repeat(9)}`,
      gitlab: `gl${"pat"}-${"x9Y8".repeat(5)}`,
      aws: `AK${"IA"}${"QWER7".repeat(3)}Z`,
      jwt: ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJlLWZha2UtMTIz"].join("."),
      openai: `s${"k"}-proj-${"abcd1234".repeat(4)}`,
      privateKey: [
        `-----BEGIN ${"RSA PRIVATE"} KEY-----`,
        "MIIEowIBAAKCAQEA",
        `-----END ${"RSA PRIVATE"} KEY-----`,
      ].join("\n"),
    };

    it.each(Object.entries(fakeSecrets))("mascara %s antes de escrever e de registrar", async (_kind, secret) => {
      const { source, events, writer } = setup();

      await writer.comment("PROJ-1", `log do build: ${secret} fim`);

      const [written] = source.commentsOf("PROJ-1");
      expect(written?.body).not.toContain(secret);
      expect(written?.body).toContain("[segredo removido]");
      expect(written?.body).toMatch(/^log do build: .* fim\n\n\*mensagem automatizada\*$/s);
      expect(JSON.stringify(events.list())).not.toContain(secret);
    });

    it("mascara o valor de atribuições de senha e token, mantendo a chave", async () => {
      const { source, writer } = setup();

      await writer.comment("PROJ-1", `DB_PASSWORD=${"hunter"}2xyz e api_key: "${"abc"}123def456"`);

      expect(source.commentsOf("PROJ-1")[0]?.body).toBe(
        'DB_PASSWORD=[segredo removido] e api_key: "[segredo removido]"\n\n*mensagem automatizada*',
      );
    });

    it("mascara segredos em JSON, mantendo chave e aspas", async () => {
      const { source, writer } = setup();

      await writer.comment("PROJ-1", `{"password":"${"hunter"}2xyz", "api_key": "${"abc"}123def456", "user": "igor"}`);

      expect(source.commentsOf("PROJ-1")[0]?.body).toBe(
        '{"password":"[segredo removido]", "api_key": "[segredo removido]", "user": "igor"}\n\n*mensagem automatizada*',
      );
    });

    it("mascara valores entre aspas com espaços e aspas escapadas", async () => {
      const { source, writer } = setup();

      await writer.comment(
        "PROJ-1",
        `{"password":"${"correct"} horse \\"battery\\" staple", "user": "igor"} senha='${"minha"} senha secreta' ok`,
      );

      expect(source.commentsOf("PROJ-1")[0]?.body).toBe(
        `{"password":"[segredo removido]", "user": "igor"} senha='[segredo removido]' ok\n\n*mensagem automatizada*`,
      );
    });

    it("mascara o valor YAML sem aspas inteiro, sem engolir a atribuição seguinte", async () => {
      const { source, writer } = setup();

      await writer.comment(
        "PROJ-1",
        `password: ${"correct"} horse battery staple api_key: ${"outra"} chave\nuser: igor\nDB_TOKEN=${"abc"}123 resto`,
      );

      expect(source.commentsOf("PROJ-1")[0]?.body).toBe(
        "password: [segredo removido] api_key: [segredo removido]\nuser: igor\nDB_TOKEN=[segredo removido] resto\n\n*mensagem automatizada*",
      );
    });

    it("um ')' no meio de um valor YAML de várias palavras não revela o resto do segredo", async () => {
      const { source, writer } = setup();

      await writer.comment("PROJ-1", `password: ${"correct"} horse) battery staple\nuser: igor`);

      const body = source.commentsOf("PROJ-1")[0]?.body ?? "";
      expect(body).toBe("password: [segredo removido]\nuser: igor\n\n*mensagem automatizada*");
      expect(body).not.toContain("battery");
    });

    it("não altera texto comum", async () => {
      const { source, writer } = setup();

      await writer.comment("PROJ-1", "A senha do usuário deve ter 8 caracteres; token de sessão expira em 1h.");

      expect(source.commentsOf("PROJ-1")[0]?.body).toBe(
        "A senha do usuário deve ter 8 caracteres; token de sessão expira em 1h.\n\n*mensagem automatizada*",
      );
    });
  });
});

describe("comentário com título, editado no lugar (upsertComment)", () => {
  it("reconhece o comentário da fábrica com o prefixo antigo e o edita para o novo, sem duplicar", async () => {
    const { source, writer } = setup();
    const legacy = await source.addComment("PROJ-1", "\u{1F916} [fábrica] SPEC\n\nv1");

    const result = await writer.upsertComment("PROJ-1", "SPEC", "v2");

    expect(result.id).toBe(legacy.id);
    expect(source.commentsOf("PROJ-1").map((c) => c.body)).toEqual(["SPEC\n\nv2\n\n*mensagem automatizada*"]);
  });

  const header = (body: string) => body.split("\n")[0];

  it("cria o comentário na primeira vez, com o título na primeira linha depois do prefixo", async () => {
    const { source, writer } = setup();

    await writer.upsertComment("PROJ-1", "SPEC", "conteúdo");

    expect(source.commentsOf("PROJ-1").map((c) => c.body)).toEqual(["SPEC\n\nconteúdo\n\n*mensagem automatizada*"]);
  });

  it("na segunda vez edita o mesmo comentário", async () => {
    const { source, events, writer } = setup();

    const first = await writer.upsertComment("PROJ-1", "SPEC", "v1");
    const second = await writer.upsertComment("PROJ-1", "SPEC", "v2");

    expect(second.id).toBe(first.id);
    expect(source.commentsOf("PROJ-1").map((c) => c.body)).toEqual(["SPEC\n\nv2\n\n*mensagem automatizada*"]);
    expect(events.list().map((e) => (e.type === "write" ? e.action : e.type))).toEqual(["comment", "edit-comment"]);
  });

  it("sem mudança no conteúdo, não escreve nada", async () => {
    const { events, writer } = setup();

    await writer.upsertComment("PROJ-1", "SPEC", "igual");
    await writer.upsertComment("PROJ-1", "SPEC", "igual");

    expect(events.list()).toHaveLength(1);
  });

  it("títulos diferentes são comentários diferentes", async () => {
    const { source, writer } = setup();

    await writer.upsertComment("PROJ-1", "SPEC", "s");
    await writer.upsertComment("PROJ-1", "Tickets", "t");

    expect(source.commentsOf("PROJ-1").map((c) => header(c.body))).toEqual(["SPEC", "Tickets"]);
  });

  it("nunca edita um comentário de outra pessoa com o mesmo título", async () => {
    const { source, writer } = setup();
    const human = source.humanComment("PROJ-1", "po", "SPEC\n\nà mão\n\n*mensagem automatizada*");

    await writer.upsertComment("PROJ-1", "SPEC", "da fábrica");

    expect(source.commentsOf("PROJ-1").find((c) => c.id === human.id)?.body).toBe(
      "SPEC\n\nà mão\n\n*mensagem automatizada*",
    );
    expect(source.commentsOf("PROJ-1")).toHaveLength(2);
  });

  it("passa pelo filtro de segredos", async () => {
    const { source, writer } = setup();

    await writer.upsertComment("PROJ-1", "SPEC", "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789");

    expect(source.commentsOf("PROJ-1")[0]?.body).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });
});

describe("menção a uma pessoa do projeto (mention)", () => {
  it("comenta mencionando a pessoa, com o prefixo, e não duplica ao repetir", async () => {
    const { source, writer } = setup();

    await writer.mention("PROJ-1", PO, "Pergunta 1: qual o separador?");
    await writer.mention("PROJ-1", PO, "Pergunta 1: qual o separador?");

    expect(source.commentsOf("PROJ-1").map((c) => c.body)).toEqual([
      `Pergunta 1: qual o separador?\n\n*mensagem automatizada*`,
    ]);
  });

  it("bloqueia o destinatário fora das pessoas do projeto e avisa por evento", async () => {
    const { source, events, writer } = setup();

    await expect(writer.mention("PROJ-1", "pessoa-de-fora", "oi")).rejects.toThrow(/guardrail/i);

    expect(source.commentsOf("PROJ-1")).toEqual([]);
    expect(events.list()).toMatchObject([
      {
        type: "blocked",
        target: "PROJ-1",
        action: "mention",
        reason: expect.stringContaining("pessoa-de-fora não está entre as pessoas do projeto"),
      },
    ]);
  });

  it("no dry-run só registra a menção", async () => {
    const { source, events, writer } = setup({ dryRun: true });

    await writer.mention("PROJ-1", PO, "Pergunta 1: qual o separador?");

    expect(source.commentsOf("PROJ-1")).toEqual([]);
    expect(events.list()).toMatchObject([{ type: "write", action: "mention", dryRun: true }]);
  });
});

describe("escritor de efeitos: issues de retrô no repositório público da fábrica", () => {
  const REPO = "fabrica/fabrica-publica";
  /** O link local de uma Tarefa na página da fábrica: também não vai ao repositório público. */
  const LINK = "http://127.0.0.1:7420/#/retro/";
  function retroSetup(opts: { dryRun?: boolean; repo?: string; name?: string } = {}) {
    const source = new MemoryDemandSource([
      { key: "PROJ-1", title: "Conciliar pagamentos do mês", status: "A Fazer", assignee: USER },
    ]);
    const events = new EventLog();
    const sink = new MemoryRetroSink();
    const writer = createEffectWriter({
      config: testProjectConfig({
        dryRun: opts.dryRun ?? false,
        ...(opts.name ? { name: opts.name } : {}),
        people: [{ id: PO, role: "po", name: "Fulana Ficticia" }],
        repositories: [
          {
            path: "/srv/codigo/servico-pagamentos",
            prefix: "PAG",
            test: { command: ["true"], timeoutSeconds: 1, files: ["x"] },
          },
        ],
      }),
      source,
      events,
      transitionLimit: "in_progress",
      retro: { sink, repo: "repo" in opts ? opts.repo : REPO },
    });
    return { events, sink, writer };
  }

  it("abre a issue com o prefixo de automação e registra a escrita", async () => {
    const { events, sink, writer } = retroSetup();

    const created = await writer.openRetroIssue("PROJ-1", REPO, { title: "Melhorar o grill", body: "Corpo." });

    expect(sink.issuesOf(REPO)).toMatchObject([
      {
        number: created?.number,
        title: "Melhorar o grill",
        body: "Corpo.\n\n*mensagem automatizada*",
        labels: ["retro"],
      },
    ]);
    expect(events.list()).toMatchObject([
      { type: "write", action: "retro-issue", target: "PROJ-1#retro", dryRun: false },
    ]);
  });

  it("só escreve no repositório da fábrica configurado: outro repositório é barrado com evento", async () => {
    const { events, sink, writer } = retroSetup();

    await expect(writer.openRetroIssue("PROJ-1", "time/servico-pagamentos", { title: "t", body: "b" })).rejects.toThrow(
      /guardrail/i,
    );
    await expect(writer.commentRetroIssue("PROJ-1", "time/servico-pagamentos", 1, "+1")).rejects.toThrow(/guardrail/i);

    expect(sink.issues).toEqual([]);
    expect(events.list()).toMatchObject([
      {
        type: "blocked",
        action: "retro-issue",
        reason: expect.stringContaining("só escreve no repositório da fábrica"),
      },
      { type: "blocked", action: "retro-comment" },
    ]);
  });

  it("sem repositório da fábrica configurado, nenhuma issue é aberta", async () => {
    const { sink, writer } = retroSetup({ repo: undefined });

    await expect(writer.openRetroIssue("PROJ-1", REPO, { title: "t", body: "b" })).rejects.toThrow(
      /FACTORY_RETRO_REPO/,
    );
    expect(sink.issues).toEqual([]);
  });

  it("saneia os valores do projeto e do card, todos os links (inclusive os da fábrica), caminhos e segredos", async () => {
    const { sink, writer } = retroSetup();
    const token = `glpat-${"x".repeat(20)}`;

    await writer.openRetroIssue("PROJ-1", REPO, {
      title: "Grill do PROJ-1 e do PAG",
      body:
        `Projeto exemplo, pessoa Fulana Ficticia (${PO}), card "Conciliar pagamentos do mês", repo servico-pagamentos ` +
        `em /srv/codigo/servico-pagamentos, chave ${token}, https://gitlab.invalid/time/x, ` +
        `${LINK}tarefa/exemplo/PROJ-1 e ${LINK}0a1b2c3d4e5f.`,
    });

    const [issue] = sink.issuesOf(REPO);
    expect(issue?.title).toBe("Grill do [removido] e do [removido]");
    expect(issue?.body).toBe(
      'Projeto [removido], pessoa [removido] ([removido]), card "[removido]", repo [removido] ' +
        "em [caminho removido], chave [segredo removido], [link removido], " +
        "[link removido] e [link removido].\n\n*mensagem automatizada*",
    );
  });

  it("remove URLs de outros esquemas e caminhos absolutos de um componente", async () => {
    const { sink, writer } = retroSetup();
    await writer.openRetroIssue("PROJ-1", REPO, {
      title: "Proteção de dados",
      body: "Conexão postgresql://app:senha@db.interno/folha e arquivo /folha-salarial.csv.",
    });
    expect(sink.issuesOf(REPO)[0]?.body).toBe(
      "Conexão [link removido] e arquivo [caminho removido].\n\n*mensagem automatizada*",
    );
  });

  it("barra grafia sem acento de nome privado curto, sem bloquear palavras que o contenham", async () => {
    const { sink, writer } = retroSetup({ name: "Ágil" });
    await expect(writer.openRetroIssue("PROJ-1", REPO, { title: "Projeto Agil", body: "b" })).rejects.toThrow(
      /guardrail/i,
    );
    await writer.openRetroIssue("PROJ-1", REPO, { title: "Fragilidade", body: "b" });
    expect(sink.issuesOf(REPO)).toHaveLength(1);
  });

  it("barra a escrita, com evento, se sobrar um valor do projeto escrito de outro jeito", async () => {
    const { events, sink, writer } = retroSetup();

    await expect(
      writer.openRetroIssue("PROJ-1", REPO, { title: "Melhorar o Servico_Pagamentos", body: "b" }),
    ).rejects.toThrow(/guardrail/i);
    await expect(writer.commentRetroIssue("PROJ-1", REPO, 1, "+1 do proj 1")).rejects.toThrow(/guardrail/i);

    expect(sink.issues).toEqual([]);
    expect(events.list()).toMatchObject([
      { type: "blocked", action: "retro-issue", reason: expect.stringContaining('"servico-pagamentos"') },
      { type: "blocked", action: "retro-comment", reason: expect.stringContaining("chave de card") },
    ]);
  });

  it("no dry-run só registra a issue e o comentário", async () => {
    const { events, sink, writer } = retroSetup({ dryRun: true });

    expect(await writer.openRetroIssue("PROJ-1", REPO, { title: "t", body: "b" })).toBeUndefined();
    await writer.commentRetroIssue("PROJ-1", REPO, 1, "+1");

    expect(sink.issues).toEqual([]);
    expect(events.list()).toMatchObject([
      { type: "write", action: "retro-issue", dryRun: true },
      { type: "write", action: "retro-comment", dryRun: true },
    ]);
  });
});
