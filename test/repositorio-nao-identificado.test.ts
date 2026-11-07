import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "../src/channel.js";
import { DEFAULT_TEST_FILES } from "../src/config.js";
import { FakeClock } from "./fakes/fake-clock.js";
import { FakeModel, scriptImplementer, write } from "./fakes/fake-model.js";
import { FakeTelegram } from "./fakes/fake-telegram.js";
import { createRemoteRepo, removeTempRoot, tempRoot } from "./fakes/git-repos.js";
import {
  api, events, eventually, poll, startTestFactory, type TestFactory, USER, waitForStatus,
} from "./harness.js";

const { enviosChannel } = vi.hoisted(() => ({ enviosChannel: vi.fn() }));
vi.mock("../src/channel.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/channel.js")>();
  return {
    ...original,
    createCardCommentChannel: (...args: Parameters<typeof original.createCardCommentChannel>) => {
      const canal = original.createCardCommentChannel(...args);
      return {
        ...canal,
        async ask(pergunta: Parameters<Channel["ask"]>[0]) {
          enviosChannel(pergunta);
          return canal.ask(pergunta);
        },
      };
    },
  };
});

let root: string;
let factory: TestFactory | undefined;
beforeEach(async () => {
  root = await tempRoot();
  enviosChannel.mockClear();
});
afterEach(async () => {
  await factory?.close();
  factory = undefined;
  await removeTempRoot(root);
});

const LEAD = "lider-do-projeto";
const BASE = "/tasks/exemplo/PROJ-1";
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
interface Pergunta {
  n: number;
  to: string;
  text: string;
  origin: string;
  answer: string | null;
}
interface Detalhe {
  status: string;
  questions: Pergunta[];
  implementation: { branch: string } | null;
}

async function iniciar(opcoes: { unico?: boolean; semUsuario?: boolean; inicio?: string } = {}) {
  const web = await createRemoteRepo(root, "web");
  const mobile = await createRemoteRepo(root, "mobile");
  const clock = new FakeClock(opcoes.inicio ?? "2025-06-10T10:00:00-03:00");
  const telegram = new FakeTelegram();
  const model = new FakeModel();
  // O modelo NÃO pergunta: entrega SPEC normalmente. Detectar a falta de
  // mapeamento é responsabilidade determinística da fábrica, não um palpite do LLM.
  scriptImplementer(model, {
    spec: "Exportar relatório em CSV.",
    tickets: [{ titulo: "Gerar CSV", aceite: "Gera uma linha com ponto e vírgula" }],
  }, [
    write({
      "test/csv.test.mjs": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { csv } from "../src/csv.mjs";\ntest("CSV", () => assert.equal(csv(), "a;b"));\n',
    }),
    write({ "src/csv.mjs": 'export const csv = () => "a;b";\n' }),
  ]);
  const people = [
    ...(opcoes.semUsuario ? [] : [{ id: USER, role: "po" as const }]),
    { id: LEAD, role: "tech_lead" as const },
  ];
  const test = { command: [process.execPath, "--test"], timeoutSeconds: 30, files: DEFAULT_TEST_FILES };
  const repositories = [
    { path: web.user, prefix: "[web]", test },
    ...(!opcoes.unico ? [{ path: mobile.user, prefix: "[mobile]", test }] : []),
  ];
  factory = await startTestFactory({
    cards: [{
      key: "PROJ-1", title: "Exportar relatório", status: "A Fazer", assignee: USER,
      description: "Exportar um relatório em CSV com cabeçalho e separador ponto e vírgula. A tela web inicia a exportação e o mobile consulta o resultado.",
    }],
    model, clock, telegram,
    config: {
      // O board/projeto PROJ e o título não têm correspondência na configuração.
      // Menções a web/mobile na descrição não autorizam escolher nenhum dos dois.
      repositories, people,
      calendar: {
        timezone: "America/Sao_Paulo", workdays: ["mon", "tue", "wed", "thu", "fri"],
        start: "09:00", end: "18:00", holidays: [],
      },
    },
  });
  const f = factory;
  await poll(f);
  return { f, clock, telegram, model, web, mobile, people };
}

async function pendente(opcoes: Parameters<typeof iniciar>[0] = {}) {
  const contexto = await iniciar(opcoes);
  const { f, telegram, model, web, mobile } = contexto;
  await waitForStatus(f, "PROJ-1", "aguardando-humano");
  const detalhe = await api<Detalhe>(f, "GET", BASE);
  expect(detalhe.questions).toHaveLength(1);
  const pergunta = detalhe.questions[0];
  expect(pergunta).toMatchObject({ n: 1, to: USER, origin: "tecnica", answer: null });
  expect(pergunta.text).toMatch(/reposit[oó]rio/i);
  await eventually(() => expect(telegram.texts()).toContainEqual(expect.stringContaining(pergunta.text)));
  const mensagem = telegram.texts().find((texto) => texto.includes(pergunta.text));
  expect(mensagem).toContain("PROJ-1");
  expect(mensagem).toContain("/responder exemplo/PROJ-1 1");
  expect(detalhe.implementation).toBeNull();
  expect(existsSync(join(f.stateDir, "worktrees", "exemplo", "PROJ-1"))).toBe(false);
  expect(model.calls.some((call) => call.tools.includes("escrever_arquivo"))).toBe(false);
  expect(f.codeHost.pushed).toEqual([]);
  expect(await web.branches()).toEqual(["main"]);
  expect(await mobile.branches()).toEqual(["main"]);
  return { ...contexto, pergunta };
}

async function responder(f: TestFactory, telegram: FakeTelegram, canal: string, texto: string) {
  if (canal === "web") {
    await api(f, "POST", `${BASE}/questions/1/answer`, { answer: texto });
  } else {
    const comando = `/responder exemplo/PROJ-1 1 ${texto}`;
    telegram.say(comando);
    await eventually(async () => expect(await events(f)).toContainEqual(expect.objectContaining({
      type: "command", text: comando, accepted: true,
    })));
  }
}

const encaminhamentos = () => enviosChannel.mock.calls
  .map(([pergunta]) => pergunta as Parameters<Channel["ask"]>[0])
  .filter((pergunta) => pergunta.to === LEAD);

async function conferirEncaminhamento(f: TestFactory, pergunta: Pergunta) {
  await eventually(() => expect(encaminhamentos()).toHaveLength(1));
  expect(encaminhamentos()[0]).toMatchObject({ card: "PROJ-1", to: LEAD });
  expect(encaminhamentos()[0].text).toContain(pergunta.text);
  expect(encaminhamentos()[0].text).toContain("PROJ-1");
  expect(encaminhamentos()[0].text).toMatch(/pergunta\s*1\b/i);
  await eventually(() => expect(f.source.commentsOf("PROJ-1").filter((c) => c.body.includes(pergunta.text))).toHaveLength(1));
}

describe("card sem repositório identificável usa o fluxo de pergunta técnica", { timeout: 30_000 }, () => {
  it.each([false, true])("disponibiliza na web e Telegram sem adivinhar, mesmo com candidato único: %s", async (unico) => {
    const { f } = await pendente({ unico });
    await poll(f);
    await settle();
    expect((await api<Detalhe>(f, "GET", BASE)).questions).toHaveLength(1);
    expect(encaminhamentos()).toEqual([]);
  });

  it.each(["web", "telegram"])("resposta resolutiva pela %s retoma a implementação no repositório explicitamente indicado", async (canal) => {
    const { f, telegram, clock, web, mobile, pergunta } = await pendente();

    // O segundo candidato da configuração: não pode simplesmente usar o primeiro.
    await responder(f, telegram, canal, mobile.user);

    // Sem /poll, alteração de config, título ou prefixo e sem /resume manual.
    await waitForStatus(f, "PROJ-1", "concluida", 20_000);
    const detalhe = await api<Detalhe>(f, "GET", BASE);
    expect(detalhe.questions).toEqual([
      expect.objectContaining({ n: pergunta.n, text: pergunta.text, answer: mobile.user }),
    ]);
    expect(detalhe.implementation).not.toBeNull();
    const branch = detalhe.implementation!.branch;
    expect(await mobile.show(branch, "src/csv.mjs")).toBe('export const csv = () => "a;b";');
    expect(await mobile.branchLog(branch)).toHaveLength(2);
    expect(await web.branches()).toEqual(["main"]);
    expect(f.codeHost.pushed).toHaveLength(1);
    clock.advanceTo("2025-06-11T18:00:00-03:00");
    await settle();
    expect(encaminhamentos()).toEqual([]);
  });

  it.each(["web", "telegram"])("'não sei' pela %s encaminha a pergunta de repositório ao tech lead e não duplica no prazo", async (canal) => {
    const { f, clock, telegram, pergunta } = await pendente();

    await responder(f, telegram, canal, "não sei");

    await conferirEncaminhamento(f, pergunta);
    clock.advanceTo("2025-06-10T12:00:00-03:00");
    await settle();
    await poll(f);
    expect(encaminhamentos()).toHaveLength(1);
    expect(f.codeHost.pushed).toEqual([]);
    expect((await api<Detalhe>(f, "GET", BASE)).questions[0].answer).toBeNull();
  });

  it("sem resposta, encaminha ao completar 120 minutos úteis, excluindo fim de semana e feriado municipal", async () => {
    const { f, clock, pergunta } = await pendente({ inicio: "2025-08-29T17:00:00-03:00" });
    clock.advanceTo("2025-09-02T09:59:59.999-03:00");
    await settle();
    expect(encaminhamentos()).toEqual([]);

    clock.advanceTo("2025-09-02T10:00:00-03:00");

    await conferirEncaminhamento(f, pergunta);
    expect(f.codeHost.pushed).toEqual([]);
  });

  it("sem usuário nas pessoas do projeto, bloqueia antes de expor a pergunta no Telegram", async () => {
    const { f, telegram } = await iniciar({ semUsuario: true });
    await waitForStatus(f, "PROJ-1", "bloqueada");
    await eventually(() => expect(telegram.texts().some((texto) => /bloquead/i.test(texto) && /projeto/i.test(texto))).toBe(true));
    expect((await events(f)).filter((e) => e.type === "question" && e.status === "enviada")).toEqual([]);
    expect(telegram.texts().some((texto) => texto.includes("/responder exemplo/PROJ-1"))).toBe(false);
    expect(enviosChannel).not.toHaveBeenCalled();
    expect(f.codeHost.pushed).toEqual([]);
  });

  it.each(["não sei", "prazo"])("revalida o guardrail do tech lead ao encaminhar por %s", async (motivo) => {
    const { f, clock, telegram, people, pergunta } = await pendente();
    people.splice(1, 1);
    if (motivo === "não sei") await responder(f, telegram, "web", "não sei");
    else clock.advanceTo("2025-06-10T12:00:00-03:00");

    await eventually(() => expect(telegram.texts().some((texto) =>
      /bloquead/i.test(texto) && /tech.?lead|líder técnico/i.test(texto) && /projeto/i.test(texto),
    )).toBe(true));
    expect(enviosChannel).not.toHaveBeenCalled();
    expect(f.source.commentsOf("PROJ-1").some((c) => c.body.includes(pergunta.text))).toBe(false);
    expect(f.codeHost.pushed).toEqual([]);
  });
});
