import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TEST_FILES, type RepoMapping } from "../src/config.js";
import { AUTOMATION_MARK } from "../src/effect-writer.js";
import { FakeModel, type SpecDelivery, scriptImplementer, write } from "./fakes/fake-model.js";
import { createRemoteRepo, git, type RemoteRepo, removeTempRoot, tempRoot } from "./fakes/git-repos.js";
import { api, events, eventually, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

const SLOW = 60_000;
const DONE_WITHIN = 45_000;

let root: string;
let factory: TestFactory | undefined;
beforeEach(async () => {
  root = await tempRoot();
});
afterEach(async () => {
  await factory?.close();
  factory = undefined;
  await removeTempRoot(root);
});

const card = (extra: object = {}) => ({
  key: "PROJ-1",
  title: "Exportar relatório em CSV",
  status: "A Fazer",
  assignee: USER,
  ...extra,
});

/** O comando de teste dos repositórios de teste: o runner do próprio Node, sem shell. */
const NODE_TEST = { command: [process.execPath, "--test"], timeoutSeconds: 30, files: DEFAULT_TEST_FILES };
const mapping = (repo: RemoteRepo, extra: Partial<RepoMapping> = {}): RepoMapping => ({
  path: repo.user,
  prefix: "PROJ",
  test: NODE_TEST,
  ...extra,
});

const ONE_TICKET: SpecDelivery = {
  spec: "Exportar o relatório em CSV.",
  tickets: [{ titulo: "Gerar CSV", aceite: "As linhas viram texto separado por ponto e vírgula" }],
};
const TWO_TICKETS: SpecDelivery = {
  spec: "Exportar o relatório em CSV com cabeçalho.",
  tickets: [...ONE_TICKET.tickets, { titulo: "Cabeçalho", aceite: "A primeira linha é data;valor" }],
};

const CSV_TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarCsv } from "../src/csv.mjs";
test("gera CSV", () => assert.equal(gerarCsv([["a", "b"]]), "a;b"));
`;
const CSV_IMPL = `export const gerarCsv = (linhas) => linhas.map((l) => l.join(";")).join("\\n");\n`;
const HEADER_TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { cabecalho } from "../src/cabecalho.mjs";
test("cabeçalho", () => assert.equal(cabecalho(), "data;valor"));
`;
const HEADER_IMPL = `export const cabecalho = () => "data;valor";\n`;

/** O ciclo TDD bem-comportado de um ticket: o teste, depois o código. */
const CSV_CYCLE = () => [write({ "test/csv.test.mjs": CSV_TEST }), write({ "src/csv.mjs": CSV_IMPL })];

const BRANCH = "feature/PROJ-1-exportar-relatorio-em-csv";

const ticketsComments = (f: TestFactory) =>
  f.source.commentsOf("PROJ-1").filter((c) => c.body.split("\n")[0] === "Tickets" && c.body.endsWith(AUTOMATION_MARK));

/** Guarda o corpo de cada edição do comentário Tickets, na ordem. */
function recordTicketsEdits(f: TestFactory): string[] {
  const bodies: string[] = [];
  const edit = f.source.editComment.bind(f.source);
  f.source.editComment = async (key, id, body) => {
    if (body.split("\n")[0] === "Tickets") bodies.push(body);
    return edit(key, id, body);
  };
  return bodies;
}

describe("implementação com TDD numa branch da fábrica", { timeout: SLOW }, () => {
  it("implementa ticket a ticket: commit de teste e de código por ticket, Tickets marcado no lugar e push da branch", async () => {
    const repo = await createRemoteRepo(root, "app", { files: { "README.md": "# app\n" } });
    const model = new FakeModel();
    scriptImplementer(model, TWO_TICKETS, [
      [...write({ "test/csv.test.mjs": CSV_TEST }), { tool: "rodar_testes", args: {} }],
      write({ "src/csv.mjs": CSV_IMPL }),
      write({ "test/cabecalho.test.mjs": HEADER_TEST }),
      write({ "src/cabecalho.mjs": HEADER_IMPL }),
    ]);
    factory = await startTestFactory({ cards: [card()], model, config: { repositories: [mapping(repo)] } });
    const edits = recordTicketsEdits(factory);
    const mainBefore = await git(repo.bare, "rev-parse", "main");

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    expect(await repo.branchLog(BRANCH)).toEqual([
      { subject: "test: adiciona teste para Gerar CSV", files: ["test/csv.test.mjs"] },
      { subject: "feat: Gerar CSV", files: ["src/csv.mjs"] },
      { subject: "test: adiciona teste para Cabeçalho", files: ["test/cabecalho.test.mjs"] },
      { subject: "feat: Cabeçalho", files: ["src/cabecalho.mjs"] },
    ]);
    expect(await repo.show(BRANCH, "src/csv.mjs")).toBe(CSV_IMPL.trim());
    // O push foi só da branch da fábrica; a main do remoto não mudou.
    expect(await repo.branches()).toEqual([BRANCH, "main"]);
    expect(await git(repo.bare, "rev-parse", "main")).toBe(mainBefore);
    expect(factory.codeHost.pushed.map((p) => p.branch)).toEqual([BRANCH]);
    // A fábrica criou a branch: é a única em que ela aceitaria force-push.
    const detail = await api<{ implementation: { branchOrigin: string } }>(factory, "GET", "/tasks/exemplo/PROJ-1");
    expect(detail.implementation.branchOrigin).toBe("criada");

    // Um único comentário Tickets, editado à medida que cada ticket ficou pronto.
    expect(ticketsComments(factory)).toHaveLength(1);
    expect(edits[0]).toContain("- [x] **1. Gerar CSV**");
    expect(edits[0]).toContain("- [ ] **2. Cabeçalho**");
    expect(ticketsComments(factory)[0]?.body).toContain("- [x] **2. Cabeçalho**");

    // rodar_testes rodou o comando configurado no clone: o teste novo, sem implementação, falhou.
    const testRun = model.calls.flatMap((c) => c.toolResults).find((r) => r.name === "rodar_testes");
    expect(testRun?.text).toContain("código de saída 1");
  });

  it("não mexe na cópia de trabalho do usuário nem no diretório do processo", async () => {
    const repo = await createRemoteRepo(root, "app");
    await writeFile(join(repo.user, "rascunho.txt"), "trabalho em andamento do usuário");
    const before = await repo.userSnapshot();
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, CSV_CYCLE());
    factory = await startTestFactory({ cards: [card()], model, config: { repositories: [mapping(repo)] } });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    expect(await repo.userSnapshot()).toBe(before);
    expect(existsSync(join(repo.user, "src", "csv.mjs"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src", "csv.mjs"))).toBe(false);
    expect(existsSync(join(process.cwd(), "test", "csv.test.mjs"))).toBe(false);
    // O rascunho não commitado do usuário não vai para a branch da fábrica.
    expect((await repo.branchLog(BRANCH)).flatMap((c) => c.files)).not.toContain("rascunho.txt");
  });

  it("segue as convenções de branch e commit descobertas no histórico do repositório", async () => {
    const repo = await createRemoteRepo(root, "app", {
      commits: ["feat: tela de login (ABC-1)", "fix: valida a senha (ABC-2)"],
      branches: ["feat/ABC-1-tela-de-login", "feat/ABC-2-senha"],
    });
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, CSV_CYCLE());
    factory = await startTestFactory({ cards: [card()], model, config: { repositories: [mapping(repo)] } });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    expect((await repo.branchLog("feat/PROJ-1-exportar-relatorio-em-csv")).map((c) => c.subject)).toEqual([
      "test: adiciona teste para Gerar CSV (PROJ-1)",
      "feat: Gerar CSV (PROJ-1)",
    ]);
  });

  it("histórico com a chave no início do commit e branches ticket/ gera a branch e os commits nesse padrão", async () => {
    const repo = await createRemoteRepo(root, "app", {
      commits: ["[ABC-1] feat: tela de login", "[ABC-2] fix: valida a senha"],
      branches: ["ticket/ABC-1-tela-de-login", "ticket/ABC-2-senha"],
    });
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, CSV_CYCLE());
    factory = await startTestFactory({ cards: [card()], model, config: { repositories: [mapping(repo)] } });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    expect((await repo.branchLog("ticket/PROJ-1-exportar-relatorio-em-csv")).map((c) => c.subject)).toEqual([
      "[PROJ-1] test: adiciona teste para Gerar CSV",
      "[PROJ-1] feat: Gerar CSV",
    ]);
  });

  it("histórico com a chave no escopo do commit gera os commits nesse padrão", async () => {
    const repo = await createRemoteRepo(root, "app", {
      commits: ["feat(ABC-1): tela de login", "fix(ABC-2): valida a senha"],
    });
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, CSV_CYCLE());
    factory = await startTestFactory({ cards: [card()], model, config: { repositories: [mapping(repo)] } });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    // Sem branches com padrão no remoto, a branch segue o padrão documentado.
    expect((await repo.branchLog(BRANCH)).map((c) => c.subject)).toEqual([
      "test(PROJ-1): adiciona teste para Gerar CSV",
      "feat(PROJ-1): Gerar CSV",
    ]);
  });

  it("a config sobrescreve as convenções descobertas", async () => {
    const repo = await createRemoteRepo(root, "app", {
      commits: ["feat: tela de login (ABC-1)"],
      branches: ["feat/ABC-1-tela-de-login"],
    });
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, CSV_CYCLE());
    factory = await startTestFactory({
      cards: [card()],
      model,
      config: {
        repositories: [mapping(repo)],
        conventions: { branch: "tarefa/{key}", commit: "[{key}] {type}: {summary}" },
      },
    });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    expect((await repo.branchLog("tarefa/PROJ-1")).map((c) => c.subject)).toEqual([
      "[PROJ-1] test: adiciona teste para Gerar CSV",
      "[PROJ-1] feat: Gerar CSV",
    ]);
  });

  it("resolve o repositório pelo prefixo no título do card", async () => {
    const web = await createRemoteRepo(root, "web");
    const mobile = await createRemoteRepo(root, "mobile");
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, CSV_CYCLE());
    factory = await startTestFactory({
      cards: [card({ title: "[web] Exportar relatório em CSV" })],
      model,
      config: {
        repositories: [
          { path: mobile.user, prefix: "[mobile]", test: NODE_TEST },
          { path: web.user, prefix: "[web]", test: NODE_TEST },
        ],
      },
    });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    expect(await web.branches()).toEqual(["feature/PROJ-1-web-exportar-relatorio-em-csv", "main"]);
    expect(await mobile.branches()).toEqual(["main"]);
  });

  it("resolve o repositório pelo prefixo da chave quando o título não corresponde", async () => {
    const web = await createRemoteRepo(root, "web");
    const mobile = await createRemoteRepo(root, "mobile");
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, CSV_CYCLE());
    factory = await startTestFactory({
      cards: [card()],
      model,
      config: {
        repositories: [
          { path: web.user, prefix: "[web]", test: NODE_TEST },
          { path: mobile.user, prefix: "PROJ", test: NODE_TEST },
        ],
      },
    });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    expect(await mobile.branches()).toEqual([BRANCH, "main"]);
    expect(await web.branches()).toEqual(["main"]);
  });

  it("sem repositório mapeado para o card, a Tarefa fica bloqueada e avisa, sem adivinhar", async () => {
    const repo = await createRemoteRepo(root, "app");
    factory = await startTestFactory({
      cards: [card({ key: "OUTRO-9", title: "Card de outro sistema" })],
      config: { repositories: [mapping(repo)] },
    });

    await poll(factory);
    await waitForStatus(factory, "OUTRO-9", "bloqueada", DONE_WITHIN);

    expect(await events(factory)).toContainEqual(
      expect.objectContaining({ type: "blocked", target: "OUTRO-9", action: "resolver-repositorio" }),
    );
    expect(await repo.branches()).toEqual(["main"]);
  });
});

describe("TDD verificado pela fábrica", { timeout: SLOW }, () => {
  it("recusa a fase de teste com código de produção ou com teste que já passa, e só commita um teste que falha", async () => {
    const repo = await createRemoteRepo(root, "app");
    const model = new FakeModel();
    const PASSING = `import { test } from "node:test";\ntest("sempre passa", () => {});\n`;
    scriptImplementer(model, ONE_TICKET, [
      write({ "test/csv.test.mjs": CSV_TEST, "src/csv.mjs": CSV_IMPL }), // teste junto com o código
      write({ "test/csv.test.mjs": PASSING }), // o teste novo já passa
      write({ "test/csv.test.mjs": CSV_TEST }), // agora o teste falha, sem código
      write({ "src/csv.mjs": CSV_IMPL }),
    ]);
    factory = await startTestFactory({ cards: [card()], model, config: { repositories: [mapping(repo)] } });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    expect(await repo.branchLog(BRANCH)).toEqual([
      { subject: "test: adiciona teste para Gerar CSV", files: ["test/csv.test.mjs"] },
      { subject: "feat: Gerar CSV", files: ["src/csv.mjs"] },
    ]);
    // O modelo soube por que cada tentativa foi recusada.
    const inputs = model.calls.map((c) => c.input).join("\n");
    expect(inputs).toContain("na fase de teste só arquivos de teste podem mudar");
    expect(inputs).toContain("src/csv.mjs");
    expect(inputs).toContain("os testes passaram");
  });

  it("recusa a fase de implementação que afrouxa ou apaga o teste, e só commita o código", async () => {
    const repo = await createRemoteRepo(root, "app");
    const model = new FakeModel();
    const LOOSENED = `import { test } from "node:test";\ntest("gera CSV", () => {});\n`;
    const clone = () => join(factory?.stateDir ?? "", "worktrees", "exemplo", "PROJ-1");
    scriptImplementer(model, ONE_TICKET, [
      write({ "test/csv.test.mjs": CSV_TEST }),
      write({ "test/csv.test.mjs": LOOSENED, "src/csv.mjs": `export const gerarCsv = () => "";\n` }), // afrouxa o teste
      async () => {
        // Apaga o teste que falhava (o modelo não tem essa ferramenta; o teste simula a mudança no clone).
        await rm(join(clone(), "test", "csv.test.mjs"));
        return [];
      },
      write({ "src/csv.mjs": CSV_IMPL }),
    ]);
    factory = await startTestFactory({ cards: [card()], model, config: { repositories: [mapping(repo)] } });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    expect(await repo.branchLog(BRANCH)).toEqual([
      { subject: "test: adiciona teste para Gerar CSV", files: ["test/csv.test.mjs"] },
      { subject: "feat: Gerar CSV", files: ["src/csv.mjs"] },
    ]);
    expect(await repo.show(BRANCH, "test/csv.test.mjs")).toBe(CSV_TEST.trim());
    const inputs = model.calls.map((c) => c.input).join("\n");
    expect(inputs).toContain("na fase de implementação os arquivos de teste não podem mudar nem ser apagados");
  });

  it("com a suíte já vermelha na branch, a Tarefa bloqueia antes do primeiro teste: a falha não seria do teste novo", async () => {
    const repo = await createRemoteRepo(root, "app", {
      files: {
        "test/quebrado.test.mjs": `import { test } from "node:test";\ntest("já quebrado", () => { throw new Error("x"); });\n`,
      },
    });
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, CSV_CYCLE());
    factory = await startTestFactory({ cards: [card()], model, config: { repositories: [mapping(repo)] } });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "bloqueada", DONE_WITHIN);

    const blocked = (await events(factory)).find((e) => e.type === "task" && e.status === "bloqueada");
    expect(blocked?.reason).toContain("linha de base");
    // O implementador nem foi chamado, e nada foi commitado nem enviado.
    expect(model.calls.some((c) => c.tools.includes("escrever_arquivo"))).toBe(false);
    expect(await repo.branches()).toEqual(["main"]);
    expect(factory.codeHost.pushed).toEqual([]);
  });

  it("código que não faz os testes passarem é recusado até o limite: a Tarefa bloqueia e nada é enviado", async () => {
    const repo = await createRemoteRepo(root, "app");
    const model = new FakeModel();
    const WRONG = `export const gerarCsv = () => "errado";\n`;
    scriptImplementer(model, ONE_TICKET, [
      write({ "test/csv.test.mjs": CSV_TEST }),
      write({ "src/csv.mjs": WRONG }),
      write({ "src/csv.mjs": WRONG }),
      write({ "src/csv.mjs": WRONG }),
    ]);
    factory = await startTestFactory({ cards: [card()], model, config: { repositories: [mapping(repo)] } });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "bloqueada", DONE_WITHIN);

    const blocked = (await events(factory)).find((e) => e.type === "task" && e.status === "bloqueada");
    expect(blocked?.reason).toContain("TDD recusado 3 vezes");
    expect(await repo.branches()).toEqual(["main"]);
    expect(factory.codeHost.pushed).toEqual([]);
  });
});

describe("guardrails da implementação", { timeout: SLOW }, () => {
  it("o modelo não tem shell e não escreve fora do clone: fora, absoluto, .git e symlink são recusados com aviso", async () => {
    const repo = await createRemoteRepo(root, "app");
    const outside = join(root, "fora");
    await mkdir(outside);
    await symlink(outside, join(repo.user, "atalho"));
    await symlink(join(outside, "novo.txt"), join(repo.user, "atalho-pendente"));
    await git(repo.user, "add", "atalho", "atalho-pendente");
    await git(repo.user, "commit", "--quiet", "-m", "chore: atalho");
    await git(repo.user, "push", "--quiet", "origin", "main");
    const mainBefore = await git(repo.bare, "rev-parse", "main");
    const refused = [
      "../PROJ-1-x/fora.txt", // irmão do clone com o mesmo prefixo de nome
      join(outside, "absoluto.txt"),
      ".git/hooks/pre-commit",
      "src/../.GIT/config",
      "atalho/fora.txt",
      "atalho-pendente",
    ];
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, [
      [
        { tool: "executar_comando", args: { comando: "git push origin main --force" } },
        { tool: "ler_arquivo", args: { caminho: "../../../fabrica.sqlite" } },
        ...write(Object.fromEntries(refused.map((path) => [path, "#!/bin/sh\necho invadido\n"]))),
        ...write({ "test/csv.test.mjs": CSV_TEST }),
      ],
      write({ "src/csv.mjs": CSV_IMPL }),
    ]);
    factory = await startTestFactory({ cards: [card()], model, config: { repositories: [mapping(repo)] } });
    // O irmão existe: só a comparação por componente de caminho (não por prefixo de texto) o recusa.
    const worktrees = join(factory.stateDir, "worktrees", "exemplo");
    await mkdir(join(worktrees, "PROJ-1-x"), { recursive: true });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(join(worktrees, "PROJ-1-x"))).toEqual([]);
    expect(existsSync(join(worktrees, "PROJ-1", ".git", "hooks", "pre-commit"))).toBe(false);
    expect(await git(repo.bare, "rev-parse", "main")).toBe(mainBefore);
    expect((await repo.branchLog(BRANCH)).flatMap((c) => c.files)).toEqual(["test/csv.test.mjs", "src/csv.mjs"]);

    // Cada recusa virou aviso; o shell nem existe para o modelo.
    const blocked = (await events(factory)).filter((e) => e.type === "blocked");
    expect(
      blocked
        .filter((e) => e.action === "escrever_arquivo")
        .map((e) => e.content)
        .sort(),
    ).toEqual([...refused].sort());
    expect(blocked.filter((e) => e.action === "ler_arquivo").map((e) => e.content)).toEqual([
      "../../../fabrica.sqlite",
    ]);
    const results = model.calls.flatMap((c) => c.toolResults);
    expect(results.find((r) => r.name === "executar_comando")?.isError).toBe(true);
    const implementerTools = model.calls.find((c) => !c.tools.includes("entregar_spec"))?.tools;
    expect([...(implementerTools ?? [])].sort()).toEqual(["escrever_arquivo", "ler_arquivo", "rodar_testes"]);
  });

  it("branch de uma pessoa com o nome da convenção é adotada, não criada: só a criada conta como da fábrica", async () => {
    const repo = await createRemoteRepo(root, "app", { branches: [BRANCH] });
    await git(repo.user, "fetch", "--quiet", "origin");
    await git(repo.user, "checkout", "--quiet", "-b", BRANCH, `origin/${BRANCH}`);
    await git(repo.user, "commit", "--quiet", "--allow-empty", "-m", "wip: começo da pessoa");
    await git(repo.user, "push", "--quiet", "origin", BRANCH);
    await git(repo.user, "checkout", "--quiet", "main");
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, CSV_CYCLE());
    factory = await startTestFactory({ cards: [card()], model, config: { repositories: [mapping(repo)] } });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    // O push normal continua na branch adotada, sobre o commit da pessoa.
    expect((await repo.branchLog(BRANCH)).map((c) => c.subject)).toEqual([
      "wip: começo da pessoa",
      "test: adiciona teste para Gerar CSV",
      "feat: Gerar CSV",
    ]);
    expect(factory.codeHost.pushed).toEqual([expect.objectContaining({ branch: BRANCH, force: false })]);
    const detail = await api<{ implementation: { branchOrigin: string } }>(factory, "GET", "/tasks/exemplo/PROJ-1");
    expect(detail.implementation.branchOrigin).toBe("adotada");
  });

  it("push numa branch protegida é bloqueado e avisado, mesmo vindo da convenção", async () => {
    const repo = await createRemoteRepo(root, "app");
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, CSV_CYCLE());
    factory = await startTestFactory({
      cards: [card()],
      model,
      config: { repositories: [mapping(repo)], conventions: { branch: "develop" } },
    });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "bloqueada", DONE_WITHIN);

    expect(await events(factory)).toContainEqual(
      expect.objectContaining({ type: "blocked", action: "push", target: "develop" }),
    );
    expect(await repo.branches()).toEqual(["main"]);
    expect(factory.codeHost.pushed).toEqual([]);
  });

  it("no dry-run nada é enviado ao remoto; o push fica registrado", async () => {
    const repo = await createRemoteRepo(root, "app");
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, CSV_CYCLE());
    factory = await startTestFactory({
      cards: [card()],
      model,
      dryRun: true,
      config: { repositories: [mapping(repo)] },
    });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    expect(await repo.branches()).toEqual(["main"]);
    expect(factory.codeHost.pushed).toEqual([]);
    expect(await events(factory)).toContainEqual(
      expect.objectContaining({ type: "write", action: "push", target: BRANCH, dryRun: true }),
    );
  });
});

describe("retomada da implementação depois de um reinício", { timeout: SLOW }, () => {
  it("reinício no meio da etapa continua no clone certo: as ferramentas do novo processo editam o clone da Tarefa", async () => {
    const repo = await createRemoteRepo(root, "app");
    const flag = join(root, "segurar-testes");
    const started = join(root, "testes-comecaram");
    const wrapper = join(root, "testes.mjs");
    const runs = join(root, "execucoes.log");
    await writeFile(flag, "");
    // Enquanto a flag existir, o comando de teste fica preso: o daemon cai no meio da verificação da fase de teste.
    // A linha de base (ainda sem o teste novo) passa direto. Cada execução fica registrada, com ou sem o teste novo.
    await writeFile(
      wrapper,
      `import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const withTest = existsSync("test/csv.test.mjs");
appendFileSync(${JSON.stringify(runs)}, withTest ? "com-teste\\n" : "sem-teste\\n");
if (withTest && existsSync(${JSON.stringify(flag)})) {
  writeFileSync(${JSON.stringify(started)}, "");
  setInterval(() => {}, 1000);
} else {
  process.exit(spawnSync(process.execPath, ["--test"], { stdio: "inherit" }).status ?? 1);
}
`,
    );
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, CSV_CYCLE());
    factory = await startTestFactory({
      cards: [card()],
      model,
      config: { repositories: [mapping(repo, { test: { ...NODE_TEST, command: [process.execPath, wrapper] } })] },
    });

    await poll(factory);
    await eventually(() => expect(existsSync(started)).toBe(true), DONE_WITHIN);
    await rm(flag);
    factory = await factory.restart();
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    expect(await repo.branchLog(BRANCH)).toEqual([
      { subject: "test: adiciona teste para Gerar CSV", files: ["test/csv.test.mjs"] },
      { subject: "feat: Gerar CSV", files: ["src/csv.mjs"] },
    ]);
    expect(await repo.show(BRANCH, "src/csv.mjs")).toBe(CSV_IMPL.trim());
    expect(existsSync(join(process.cwd(), "src", "csv.mjs"))).toBe(false);
    // A linha de base rodou uma vez só: a retomada usou o resultado registrado, sem rodar a suíte com o teste novo.
    expect((await readFile(runs, "utf8")).split("\n").filter((l) => l === "sem-teste")).toHaveLength(1);
  });

  it("queda entre o commit e o registro do progresso não duplica o commit na retomada", async () => {
    const repo = await createRemoteRepo(root, "app");
    const model = new FakeModel();
    scriptImplementer(model, ONE_TICKET, CSV_CYCLE());
    factory = await startTestFactory({ cards: [card()], model, config: { repositories: [mapping(repo)] } });
    const source = factory.source;
    const edit = source.editComment.bind(source);
    let stuck = true;
    let reached = false;
    // Marcar o ticket no card nunca termina: o daemon cai logo depois do commit do código.
    source.editComment = async (key, id, body) => {
      if (stuck && body.includes("- [x]")) {
        reached = true;
        return new Promise<void>(() => {});
      }
      return edit(key, id, body);
    };

    await poll(factory);
    await eventually(() => expect(reached).toBe(true), DONE_WITHIN);
    stuck = false;
    factory = await factory.restart();
    await waitForStatus(factory, "PROJ-1", "concluida", DONE_WITHIN);

    expect((await repo.branchLog(BRANCH)).map((c) => c.subject)).toEqual([
      "test: adiciona teste para Gerar CSV",
      "feat: Gerar CSV",
    ]);
    expect(ticketsComments(factory)[0]?.body).toContain("- [x] **1. Gerar CSV**");
  });
});
