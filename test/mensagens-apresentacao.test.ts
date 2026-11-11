import { describe, expect, it } from "vitest";
import { mensagemDoEvento, type PortasApresentacao } from "../src/packages/mensagens-gestao/index.js";

// Mensagem de cada evento para o Telegram: fixa os botões de resposta e de veto (este só com prazo aberto), a SPEC pronta
// para revisão, a falha de leitura que não prende o aviso, o modo sem conteúdo completo e os eventos que não viram mensagem.

const AGORA = Date.parse("2026-01-10T12:00:00.000Z");
const portas = (extra: Partial<PortasApresentacao> = {}): PortasApresentacao => ({
  agora: () => AGORA,
  tarefas: async () => [],
  conteudoCompleto: () => true,
  ...extra,
});

describe("Apresentação: perguntas e tarefas assumidas", () => {
  it("pergunta enviada traz o texto e o botão de responder; outro status não vira mensagem", async () => {
    const m = await mensagemDoEvento(
      { type: "question", project: "sf", target: "K-1", n: 2, text: "Qual prazo?", status: "enviada" },
      portas(),
    );
    expect(m?.text).toContain("Pergunta 2 sobre K-1 (sf): Qual prazo?");
    expect(m?.buttons).toEqual([{ label: "Responder", command: "/responder sf/K-1 2" }]);
    expect(
      await mensagemDoEvento(
        { type: "question", project: "sf", target: "K-1", n: 2, text: "x", status: "respondida" },
        portas(),
      ),
    ).toBeNull();
  });

  it("assumido aguardando veto não avisa; assumido normal traz pausar e cancelar", async () => {
    expect(
      await mensagemDoEvento({ type: "assumed", project: "sf", target: "K-1", title: "t", waitsVeto: true }, portas()),
    ).toBeNull();
    const m = await mensagemDoEvento({ type: "assumed", project: "sf", target: "K-1", title: "Título" }, portas());
    expect(m?.buttons?.map((b) => b.command)).toEqual(["/pausar sf/K-1", "/cancelar sf/K-1"]);
  });
});

describe("Apresentação: avisos e veto", () => {
  it("veto só aparece com o prazo ainda aberto", async () => {
    const aberto = await mensagemDoEvento(
      {
        type: "notify",
        project: "sf",
        target: "K-1",
        reason: "aguardando-veto",
        message: "m",
        until: "2026-01-10T13:00:00.000Z",
      },
      portas(),
    );
    expect(aberto?.buttons).toEqual([{ label: "Vetar", command: "/vetar sf/K-1" }]);
    const fechado = await mensagemDoEvento(
      {
        type: "notify",
        project: "sf",
        target: "K-1",
        reason: "aguardando-veto",
        message: "m",
        until: "2026-01-10T11:00:00.000Z",
      },
      portas(),
    );
    expect(fechado?.buttons).toBeUndefined();
  });

  it("sem conteúdo completo, o aviso aponta a interface web em vez do texto", async () => {
    const m = await mensagemDoEvento(
      { type: "notify", project: "sf", target: "K-1", reason: "x", message: "segredo" },
      portas({ conteudoCompleto: () => false }),
    );
    expect(m?.text).not.toContain("segredo");
    expect(m?.text).toContain("Aviso (x) no card K-1 (sf).");
  });
});

describe("Apresentação: tarefas", () => {
  it("aguardando humano com SPEC em rascunho pede revisão na interface", async () => {
    const m = await mensagemDoEvento(
      { type: "task", project: "sf", key: "K-1", id: "sf/K-1", status: "aguardando-humano" },
      portas({ tarefas: async () => [{ id: "sf/K-1", specReview: "draft" }] }),
    );
    expect(m?.text).toContain("SPEC de K-1 (sf) pronta para revisão");
  });

  it("falha ao ler as tarefas não prende o aviso: vira mensagem genérica", async () => {
    const m = await mensagemDoEvento(
      { type: "task", project: "sf", key: "K-1", id: "sf/K-1", status: "aguardando-humano" },
      portas({
        tarefas: async () => {
          throw new Error("fila indisponível");
        },
      }),
    );
    expect(m?.text).toContain("aguarda sua atenção");
  });

  it("concluída e bloqueada têm mensagem; outros status não", async () => {
    expect(
      (await mensagemDoEvento({ type: "task", project: "sf", key: "K-1", id: "x", status: "concluida" }, portas()))
        ?.text,
    ).toContain("terminou");
    expect(
      await mensagemDoEvento({ type: "task", project: "sf", key: "K-1", id: "x", status: "enfileirada" }, portas()),
    ).toBeNull();
  });

  it("evento que não é de apresentação (escrita, progresso) não vira mensagem", async () => {
    expect(await mensagemDoEvento({ type: "write", project: "sf" }, portas())).toBeNull();
  });
});
