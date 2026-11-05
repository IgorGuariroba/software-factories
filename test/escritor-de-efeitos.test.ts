import { describe, expect, it } from "vitest";
import { createEffectWriter } from "../src/effect-writer.js";
import { EventLog } from "../src/events.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";
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

    expect(source.commentsOf("PROJ-1").map((c) => c.body)).toEqual(["🤖 [fábrica] Assumindo este card."]);
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
        content: "🤖 [fábrica] Assumindo este card.",
        dryRun: true,
      },
      { type: "write", target: "PROJ-1", action: "transition", content: "Em Andamento", dryRun: true },
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
        "🤖 [fábrica] SPEC v2",
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
      expect(written?.body).toMatch(/^🤖 \[fábrica\] log do build: .* fim$/s);
      expect(JSON.stringify(events.list())).not.toContain(secret);
    });

    it("mascara o valor de atribuições de senha e token, mantendo a chave", async () => {
      const { source, writer } = setup();

      await writer.comment("PROJ-1", `DB_PASSWORD=${"hunter"}2xyz e api_key: "${"abc"}123def456"`);

      expect(source.commentsOf("PROJ-1")[0]?.body).toBe(
        '🤖 [fábrica] DB_PASSWORD=[segredo removido] e api_key: "[segredo removido]"',
      );
    });

    it("mascara segredos em JSON, mantendo chave e aspas", async () => {
      const { source, writer } = setup();

      await writer.comment("PROJ-1", `{"password":"${"hunter"}2xyz", "api_key": "${"abc"}123def456", "user": "igor"}`);

      expect(source.commentsOf("PROJ-1")[0]?.body).toBe(
        '🤖 [fábrica] {"password":"[segredo removido]", "api_key": "[segredo removido]", "user": "igor"}',
      );
    });

    it("mascara valores entre aspas com espaços e aspas escapadas", async () => {
      const { source, writer } = setup();

      await writer.comment(
        "PROJ-1",
        `{"password":"${"correct"} horse \\"battery\\" staple", "user": "igor"} senha='${"minha"} senha secreta' ok`,
      );

      expect(source.commentsOf("PROJ-1")[0]?.body).toBe(
        `🤖 [fábrica] {"password":"[segredo removido]", "user": "igor"} senha='[segredo removido]' ok`,
      );
    });

    it("mascara o valor YAML sem aspas inteiro, sem engolir a atribuição seguinte", async () => {
      const { source, writer } = setup();

      await writer.comment(
        "PROJ-1",
        `password: ${"correct"} horse battery staple api_key: ${"outra"} chave\nuser: igor\nDB_TOKEN=${"abc"}123 resto`,
      );

      expect(source.commentsOf("PROJ-1")[0]?.body).toBe(
        "🤖 [fábrica] password: [segredo removido] api_key: [segredo removido]\nuser: igor\nDB_TOKEN=[segredo removido] resto",
      );
    });

    it("não altera texto comum", async () => {
      const { source, writer } = setup();

      await writer.comment("PROJ-1", "A senha do usuário deve ter 8 caracteres; token de sessão expira em 1h.");

      expect(source.commentsOf("PROJ-1")[0]?.body).toBe(
        "🤖 [fábrica] A senha do usuário deve ter 8 caracteres; token de sessão expira em 1h.",
      );
    });
  });
});

describe("comentário com título, editado no lugar (upsertComment)", () => {
  const header = (body: string) => body.split("\n")[0];

  it("cria o comentário na primeira vez, com o título na primeira linha depois do prefixo", async () => {
    const { source, writer } = setup();

    await writer.upsertComment("PROJ-1", "SPEC", "conteúdo");

    expect(source.commentsOf("PROJ-1").map((c) => c.body)).toEqual(["🤖 [fábrica] SPEC\n\nconteúdo"]);
  });

  it("na segunda vez edita o mesmo comentário", async () => {
    const { source, events, writer } = setup();

    const first = await writer.upsertComment("PROJ-1", "SPEC", "v1");
    const second = await writer.upsertComment("PROJ-1", "SPEC", "v2");

    expect(second.id).toBe(first.id);
    expect(source.commentsOf("PROJ-1").map((c) => c.body)).toEqual(["🤖 [fábrica] SPEC\n\nv2"]);
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

    expect(source.commentsOf("PROJ-1").map((c) => header(c.body))).toEqual([
      "🤖 [fábrica] SPEC",
      "🤖 [fábrica] Tickets",
    ]);
  });

  it("nunca edita um comentário de outra pessoa com o mesmo título", async () => {
    const { source, writer } = setup();
    const human = source.humanComment("PROJ-1", "po", "🤖 [fábrica] SPEC\n\nà mão");

    await writer.upsertComment("PROJ-1", "SPEC", "da fábrica");

    expect(source.commentsOf("PROJ-1").find((c) => c.id === human.id)?.body).toBe("🤖 [fábrica] SPEC\n\nà mão");
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
      `\u{1F916} [fábrica] [~accountid:${PO}] Pergunta 1: qual o separador?`,
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
