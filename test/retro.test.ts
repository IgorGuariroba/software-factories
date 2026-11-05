import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TEST_FILES } from "../src/config.js";
import { RETRO_PUBLIC_RULE } from "../src/retro-stage.js";
import { deliverRetro, FakeModel, type RetroProposal, scriptImplementer, write } from "./fakes/fake-model.js";
import { FakeTelegram } from "./fakes/fake-telegram.js";
import { createRemoteRepo, removeTempRoot, tempRoot } from "./fakes/git-repos.js";
import {
  api,
  events,
  eventually,
  FACTORY_REPO,
  hold,
  PO,
  poll,
  startTestFactory,
  type TestFactory,
  tasks,
  USER,
  waitForStatus,
} from "./harness.js";

let factory: TestFactory | undefined;
let root: string | undefined;
beforeEach(() => {
  root = undefined;
});
afterEach(async () => {
  await factory?.close();
  factory = undefined;
  if (root) await removeTempRoot(root);
});

const card = (extra: object = {}) => ({
  key: "PROJ-1",
  title: "Exportar relatório em CSV",
  status: "A Fazer",
  assignee: USER,
  ...extra,
});

type Proposal = {
  n: number;
  kind: string;
  title: string;
  status: string;
  issue: { number: number; url: string } | null;
  reason: string | null;
};
type Retro = { stage: string; status: string; summary: string | null; attempts: number; proposals: Proposal[] };
type Detail = { ref: string; status: string; retros: Retro[] };

const detail = (f: TestFactory) => api<Detail>(f, "GET", "/tasks/exemplo/PROJ-1");

async function approveAll(f: TestFactory, project = "exemplo") {
  const result = await api<Detail>(f, "GET", `/tasks/${project}/PROJ-1`);
  for (const retro of result.retros) {
    for (const proposal of retro.proposals.filter((p) => p.kind === "fabrica" && p.status === "pendente")) {
      const url = `/tasks/${project}/PROJ-1/retros/${retro.stage}/${proposal.n}`;
      const preview = await api<{ revision: string; blocked: boolean }>(f, "GET", url);
      if (preview.blocked) continue;
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch(`${f.url}${url}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ revision: preview.revision }),
        });
        if (response.ok) break;
      }
      expect(response?.status).toBe(200);
    }
  }
}

const fabrica = (
  titulo: string,
  descricao = "A etapa poderia validar a entrega antes de publicar.",
): RetroProposal => ({
  tipo: "fabrica",
  titulo,
  descricao,
});

/** A retrô da SPEC entrega `spec`; a consolidada, `tarefa` (padrão: nenhuma proposta). */
function scriptRetros(model: FakeModel, spec: RetroProposal[], tarefa: RetroProposal[] = []) {
  model.respondRetro = () =>
    model.retroCalls.length === 1 ? deliverRetro("Retrô da SPEC.", spec) : deliverRetro("Consolidada.", tarefa);
}

const NODE_TEST = { command: [process.execPath, "--test"], timeoutSeconds: 30, files: DEFAULT_TEST_FILES };

describe("retrô por etapa e consolidada", () => {
  it("a etapa SPEC termina com a sua retrô e a tarefa com a consolidada, visíveis no detalhe da API", async () => {
    const model = new FakeModel();
    model.respondRetro = () => deliverRetro(`Retrô número ${model.retroCalls.length}.`);
    factory = await startTestFactory({ cards: [card()], model });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const { retros } = await detail(factory);
    // Sem repositório mapeado, a implementação não roda: não há o que avaliar nela.
    expect(retros.map((r) => [r.stage, r.status, r.summary])).toEqual([
      ["spec", "concluida", "Retrô número 1."],
      ["tarefa", "concluida", "Retrô número 2."],
    ]);
    // A consolidada recebe as retrôs das etapas.
    expect(model.retroCalls[1]?.input).toContain("Retrô número 1.");
  });

  it("a implementação também termina com a sua retrô, antes da consolidada", { timeout: 60_000 }, async () => {
    root = await tempRoot();
    const repo = await createRemoteRepo(root, "app");
    const model = new FakeModel();
    scriptImplementer(model, { spec: "CSV.", tickets: [{ titulo: "Gerar CSV", aceite: "gera" }] }, [
      write({
        "test/csv.test.mjs": 'import { test } from "node:test";\nimport "../src/csv.mjs";\ntest("x", () => {});\n',
      }),
      write({ "src/csv.mjs": "export const x = 1;\n" }),
    ]);
    model.respondRetro = () => deliverRetro(`Retrô ${model.retroCalls.length}.`);
    factory = await startTestFactory({
      cards: [card()],
      model,
      config: { repositories: [{ path: repo.user, prefix: "PROJ", test: NODE_TEST }] },
    });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida", 45_000);

    const { retros } = await detail(factory);
    expect(retros.map((r) => [r.stage, r.status])).toEqual([
      ["spec", "concluida"],
      ["implementacao", "concluida"],
      ["tarefa", "concluida"],
    ]);
    expect(model.retroCalls[1]?.input).toMatch(/commits aceitos: 2/);
  });

  it("usa o modelo de roles.retro; sem ele, o de roles.spec", async () => {
    factory = await startTestFactory({
      cards: [card()],
      config: {
        roles: {
          spec: { provider: FakeModel.PROVIDER, model: "spec-a" },
          retro: { provider: FakeModel.PROVIDER, model: "spec-b" },
        },
      },
    });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(factory.retroSink.issues).toEqual([]);
    expect(factory.model.retroCalls.map((c) => c.model)).toEqual(["spec-b", "spec-b"]);
    await factory.close();

    factory = await startTestFactory({ cards: [card()] });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(factory.model.retroCalls.map((c) => c.model)).toEqual(["spec-a", "spec-a"]);
  });
});

describe("propostas da fábrica viram issues retro", () => {
  it("abre uma issue com a label retro no repositório da fábrica, com o id opaco da tarefa e nenhuma URL", async () => {
    const model = new FakeModel();
    scriptRetros(model, [
      fabrica(
        "Validar a SPEC contra os critérios antes de publicar",
        // O modelo cita um link da própria fábrica: ele também sai.
        "A etapa poderia validar a entrega antes de publicar. Veja http://127.0.0.1:7420/#/retro/0a1b2c3d4e5f.",
      ),
    ]);
    factory = await startTestFactory({ cards: [card()], model });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    await approveAll(factory);

    const [issue] = factory.retroSink.issues;
    expect(factory.retroSink.issues).toHaveLength(1);
    expect(issue).toMatchObject({
      repo: FACTORY_REPO,
      labels: ["retro"],
      title: "Validar a SPEC contra os critérios antes de publicar",
    });
    const { ref, retros } = await detail(factory);
    expect(ref).toMatch(/^[0-9a-f]{12}$/);
    expect(issue?.body).toContain("A etapa poderia validar a entrega antes de publicar.");
    expect(issue?.body).toContain(`tarefa \`${ref}\``);
    expect(issue?.body).not.toMatch(/https?:\/\//);
    expect(issue?.body).not.toContain("#/retro/");
    expect(retros[0]?.proposals).toMatchObject([
      { n: 1, kind: "fabrica", status: "issue-criada", issue: { number: issue?.number, url: issue?.url } },
    ]);
    // O id opaco resolve a Tarefa: a API lista a Tarefa com ele.
    expect((await tasks(factory)).find((t) => (t as { ref?: string }).ref === ref)?.key).toBe("PROJ-1");
  });

  it("com uma issue parecida já aberta, comenta '+1' com o id opaco da tarefa, sem URL, em vez de abrir outra", async () => {
    const model = new FakeModel();
    scriptRetros(model, [fabrica("Validar SPEC contra critérios antes da publicação")]);
    factory = await startTestFactory({ cards: [card()], model });
    const existing = factory.retroSink.seed(FACTORY_REPO, {
      title: "Validar a spec contra os critérios antes de publicar",
    });
    // Parecidas, mas fechada ou sem a label retro: não contam.
    factory.retroSink.seed(FACTORY_REPO, {
      title: "Validar a spec contra os critérios antes de publicar",
      state: "closed",
    });
    factory.retroSink.seed(FACTORY_REPO, { title: "Validar a spec contra os critérios antes de publicar", labels: [] });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    await approveAll(factory);

    const { ref, retros } = await detail(factory);
    expect(factory.retroSink.issues).toHaveLength(3);
    expect(existing.comments).toHaveLength(1);
    expect(existing.comments[0]).toMatch(/\+1/);
    expect(existing.comments[0]).toContain(`tarefa \`${ref}\``);
    expect(existing.comments[0]).not.toMatch(/https?:\/\//);
    expect(retros[0]?.proposals).toMatchObject([{ status: "mais-um", issue: { number: existing.number } }]);
  });

  it("uma proposta diferente das abertas abre issue nova; a consolidada que repete a da etapa não comenta de novo", async () => {
    const model = new FakeModel();
    scriptRetros(
      model,
      [fabrica("Limitar o tamanho dos anexos lidos pelo grill")],
      [fabrica("Limitar tamanho de anexos lidos no grill"), fabrica("Registrar o custo de cada etapa")],
    );
    factory = await startTestFactory({ cards: [card()], model });
    factory.retroSink.seed(FACTORY_REPO, { title: "Melhorar mensagens de erro do Telegram" });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    await approveAll(factory);

    const titles = factory.retroSink.issues.map((i) => i.title);
    expect(titles).toEqual([
      "Melhorar mensagens de erro do Telegram",
      "Limitar o tamanho dos anexos lidos pelo grill",
      "Registrar o custo de cada etapa",
    ]);
    expect(factory.retroSink.issues.every((i) => i.comments.length === 0)).toBe(true);
    const { retros } = await detail(factory);
    expect(retros[1]?.proposals.map((p) => p.status)).toEqual(["ja-registrada", "issue-criada"]);
  });

  it("uma nova tentativa depois de uma queda do GitHub não chama o modelo de novo nem duplica issue ou '+1'", async () => {
    const model = new FakeModel();
    scriptRetros(model, [fabrica("Validar a SPEC contra os critérios"), fabrica("Registrar o custo de cada etapa")]);
    factory = await startTestFactory({ cards: [card()], model });
    const sink = factory.retroSink;
    const existing = sink.seed(FACTORY_REPO, { title: "Validar a SPEC contra os critérios" });
    // O "+1" sai, mas a resposta se perde; depois, a criação da segunda issue também cai uma vez.
    const comment = sink.comment.bind(sink);
    let lostComment = 1;
    sink.comment = async (repo, number, body) => {
      await comment(repo, number, body);
      if (lostComment-- > 0) throw new Error("tempo esgotado");
    };
    const create = sink.create.bind(sink);
    let failedCreate = 1;
    sink.create = async (repo, issue) => {
      if (failedCreate-- > 0) throw new Error("GitHub fora do ar");
      return create(repo, issue);
    };

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    await approveAll(factory);

    expect(model.retroCalls).toHaveLength(2);
    expect(existing.comments).toHaveLength(1);
    expect(sink.issues.map((i) => i.title)).toEqual([
      "Validar a SPEC contra os critérios",
      "Registrar o custo de cada etapa",
    ]);
    const { retros } = await detail(factory);
    expect(retros[0]).toMatchObject({ status: "concluida", attempts: 0 });
    expect(retros[0]?.proposals.map((p) => p.status)).toEqual(["mais-um", "issue-criada"]);
  });

  it("não duplica issue quando o saneamento altera o marcador e o título", async () => {
    const model = new FakeModel();
    scriptRetros(model, [fabrica("Melhorar SPEC")]);
    factory = await startTestFactory({ cards: [card()], model, config: { name: "SPEC" } });
    const sink = factory.retroSink;
    const create = sink.create.bind(sink);
    let lost = true;
    sink.create = async (repo, issue) => {
      const result = await create(repo, issue);
      if (lost) {
        lost = false;
        throw new Error("resposta perdida");
      }
      return result;
    };
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    await approveAll(factory, "SPEC");
    expect(sink.issues).toHaveLength(1);
  });

  it("aguarda revisão explícita do conteúdo público sem bloquear a tarefa", async () => {
    const model = new FakeModel();
    scriptRetros(model, [fabrica("Melhorar validação", "Validar antes de publicar.")]);
    factory = await startTestFactory({ cards: [card()], model });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(factory.retroSink.issues).toHaveLength(0);
    expect((await detail(factory)).retros[0]?.proposals[0]?.status).toBe("pendente");
    const url = "/tasks/exemplo/PROJ-1/retros/spec/1";
    const preview = await api<{ title: string; body: string; revision: string }>(factory, "GET", url);
    expect(preview.title).toBe("Melhorar validação");
    expect(preview.body).toContain("Validar antes de publicar.");
    const stale = await fetch(`${factory.url}${url}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: "obsoleta" }),
    });
    expect(stale.status).toBe(409);
    expect(factory.retroSink.issues).toHaveLength(0);
    await api(factory, "POST", `${url}/approve`, { revision: preview.revision });
    expect(factory.retroSink.issues).toHaveLength(1);
    expect(factory.retroSink.issues[0]?.body).toBe(preview.body);
    const repeated = await fetch(`${factory.url}${url}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: preview.revision }),
    });
    expect(repeated.status).toBe(409);
    expect(factory.retroSink.issues).toHaveLength(1);
  });

  it("não publica propostas simultaneamente enquanto deduplica issues", async () => {
    const model = new FakeModel();
    scriptRetros(model, [fabrica("Validar critérios da SPEC"), fabrica("Validar os critérios da SPEC")]);
    factory = await startTestFactory({ cards: [card()], model });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    const firstUrl = "/tasks/exemplo/PROJ-1/retros/spec/1";
    const secondUrl = "/tasks/exemplo/PROJ-1/retros/spec/2";
    const first = await api<{ revision: string }>(factory, "GET", firstUrl);
    const second = await api<{ revision: string }>(factory, "GET", secondUrl);
    const gate = hold();
    const reached = hold();
    const list = factory.retroSink.listOpen.bind(factory.retroSink);
    factory.retroSink.listOpen = async (repo) => {
      reached.release();
      await gate.promise;
      return list(repo);
    };
    const post = (url: string, revision: string) =>
      fetch(`${factory?.url}${url}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision }),
      });
    const publishing = post(firstUrl, first.revision);
    await reached.promise;
    expect((await post(secondUrl, second.revision)).status).toBe(409);
    gate.release();
    expect((await publishing).status).toBe(200);
    expect((await post(secondUrl, second.revision)).status).toBe(200);
    expect(factory.retroSink.issues).toHaveLength(1);
  });

  it("sobrevive a um reinício entre a entrega do modelo e a aprovação", async () => {
    const model = new FakeModel();
    scriptRetros(model, [fabrica("Validar a SPEC contra os critérios")]);
    factory = await startTestFactory({ cards: [card()], model });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    factory = await factory.restart();
    expect(factory.retroSink.issues).toHaveLength(0);
    await approveAll(factory);
    expect(factory.model.retroCalls).toHaveLength(2);
    expect(factory.retroSink.issues).toHaveLength(1);
  });
});

describe("outros tipos de proposta", () => {
  it("uma sugestão para o repo do time vira só um aviso ao usuário: nenhuma issue, nenhum MR, nada no card", async () => {
    const telegram = new FakeTelegram();
    const model = new FakeModel();
    scriptRetros(model, [
      { tipo: "repo-time", titulo: "Adicionar lint ao CI do time", descricao: "O repositório não roda lint no CI." },
    ]);
    factory = await startTestFactory({ cards: [card()], model, telegram });
    const commentsBefore = () => factory?.source.commentsOf("PROJ-1").length ?? 0;

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const notify = (await events(factory)).filter((e) => e.type === "notify" && e.reason === "sugestao-repo-time");
    expect(notify).toHaveLength(1);
    expect(notify[0]?.message).toContain("Adicionar lint ao CI do time");
    await eventually(() => expect(telegram.texts().some((t) => t.includes("Adicionar lint ao CI do time"))).toBe(true));
    expect(factory.retroSink.issues).toEqual([]);
    expect(factory.codeHost.pushed).toEqual([]);
    // No card, só a assunção, a SPEC e os Tickets.
    expect(commentsBefore()).toBe(3);
    expect(factory.source.commentsOf("PROJ-1").some((c) => c.body.includes("lint"))).toBe(false);
    const { retros } = await detail(factory);
    expect(retros[0]?.proposals).toMatchObject([{ kind: "repo-time", status: "avisada", issue: null }]);
  });

  it("uma proposta de conhecimento do projeto fica pendente de aprovação, sem issue", async () => {
    const model = new FakeModel();
    scriptRetros(model, [
      { tipo: "conhecimento", titulo: "Relatórios usam ponto e vírgula", descricao: "Registrar o separador." },
    ]);
    factory = await startTestFactory({ cards: [card()], model });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const { retros } = await detail(factory);
    expect(retros[0]?.proposals).toMatchObject([
      { kind: "conhecimento", title: "Relatórios usam ponto e vírgula", status: "pendente" },
    ]);
    expect(factory.retroSink.issues).toEqual([]);
  });
});

describe("o repositório da fábrica é público", () => {
  it("o texto sai sem segredos e sem valores do projeto ou do card", async () => {
    const model = new FakeModel();
    const token = `ghp_${"a1B2c3D4e5".repeat(4)}`;
    scriptRetros(model, [
      fabrica(
        "Ler anexos grandes do PROJ-1 em partes",
        `No projeto exemplo, a pergunta ao ${PO} sobre "Exportar relatório em CSV" demorou; ` +
          `token=${token}; ver https://jira.invalid/browse/PROJ-1 e /home/pessoa/app/README.md.`,
      ),
    ]);
    factory = await startTestFactory({ cards: [card()], model });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    await approveAll(factory);

    const [issue] = factory.retroSink.issues;
    const text = `${issue?.title}\n${issue?.body}`;
    expect(issue?.title).toBe("Ler anexos grandes do [removido] em partes");
    for (const leaked of [
      token,
      "PROJ-1",
      "exemplo",
      PO,
      "Exportar relatório em CSV",
      "jira.invalid",
      "/home/pessoa",
      USER,
    ])
      expect(text).not.toContain(leaked);
    expect(text).toContain("[segredo removido]");
  });

  it("se sobrar um valor do projeto escrito de outro jeito, a escrita é barrada com evento e a tarefa segue", async () => {
    const model = new FakeModel();
    scriptRetros(model, [
      fabrica("Detalhar melhor as perguntas ao Po_Ficticio"),
      fabrica("Citar o proj_1 no grill"),
      fabrica("Registrar o custo de cada etapa"),
    ]);
    factory = await startTestFactory({ cards: [card()], model });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    await approveAll(factory);

    expect(factory.retroSink.issues.map((i) => i.title)).toEqual(["Registrar o custo de cada etapa"]);
    const first = await api<{ blocked: boolean; revision: string }>(
      factory,
      "GET",
      "/tasks/exemplo/PROJ-1/retros/spec/1",
    );
    expect(first.blocked).toBe(true);
    const refused = await fetch(`${factory.url}/tasks/exemplo/PROJ-1/retros/spec/1/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: first.revision }),
    });
    expect(refused.status).toBe(409);
    const { retros } = await detail(factory);
    expect(retros[0]?.proposals.map((p) => p.status)).toEqual(["pendente", "pendente", "issue-criada"]);
  });

  it("o modelo da retrô recebe a regra de descrever só a fábrica", async () => {
    factory = await startTestFactory({ cards: [card()] });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    expect(factory.model.retroCalls[0]?.context).toContain(RETRO_PUBLIC_RULE);
  });
});

describe("a retrô não bloqueia a entrega", () => {
  it("com o GitHub fora do ar, a tarefa termina e a aprovação pode ser repetida", async () => {
    const model = new FakeModel();
    scriptRetros(model, [fabrica("Validar a SPEC contra os critérios")]);
    factory = await startTestFactory({ cards: [card()], model });
    factory.retroSink.failNext = 1;
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    expect((await detail(factory)).retros[0]?.proposals[0]?.status).toBe("pendente");
    await approveAll(factory);
    expect(factory.retroSink.issues).toHaveLength(1);
    expect(model.retroCalls).toHaveLength(2);
  });

  it("uma retrô que o modelo não entrega também desiste no limite, sem bloquear", async () => {
    const model = new FakeModel();
    model.respondRetro = () => FakeModel.text("Sem retrô.");
    factory = await startTestFactory({ cards: [card()], model });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const { retros } = await detail(factory);
    expect(retros.map((r) => r.status)).toEqual(["falhou", "falhou"]);
    // Cada tentativa é um pedido novo ao modelo, na mesma conversa da retrô.
    expect(model.retroCalls).toHaveLength(6);
  });

  it("sem repositório da fábrica configurado, as propostas ficam só registradas", async () => {
    const model = new FakeModel();
    scriptRetros(model, [fabrica("Validar a SPEC contra os critérios")]);
    factory = await startTestFactory({ cards: [card()], model, retroRepo: null });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");

    const { retros } = await detail(factory);
    expect(retros[0]?.proposals).toMatchObject([{ status: "pendente", issue: null }]);
    expect(factory.retroSink.issues).toEqual([]);
  });

  it("no dry-run, a issue e o '+1' viram só escritas registradas", async () => {
    const model = new FakeModel();
    scriptRetros(model, [fabrica("Validar a SPEC contra os critérios"), fabrica("Registrar o custo de cada etapa")]);
    factory = await startTestFactory({ cards: [card()], model, dryRun: true });
    const existing = factory.retroSink.seed(FACTORY_REPO, { title: "Validar a SPEC contra os critérios" });

    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    await approveAll(factory);

    expect(factory.retroSink.issues).toHaveLength(1);
    expect(existing.comments).toEqual([]);
    const writes = (await events(factory)).filter((e) => e.type === "write" && String(e.action).startsWith("retro-"));
    expect(writes.map((w) => [w.action, w.dryRun])).toEqual([
      ["retro-comment", true],
      ["retro-issue", true],
    ]);
    const { retros } = await detail(factory);
    expect(retros[0]?.proposals.map((p) => p.status)).toEqual(["dry-run", "dry-run"]);
  });
});
