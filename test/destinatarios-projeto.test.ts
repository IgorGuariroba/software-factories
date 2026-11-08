import { describe, expect, it, vi } from "vitest";
import { createCardCommentChannel } from "../src/channel.js";
import { createEffectWriter } from "../src/effect-writer.js";
import { EventLog } from "../src/events.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";
import { testProjectConfig, USER } from "./harness.js";

const LEAD = "lider-do-projeto";
const papeis = [
  { papel: "usuário", permitido: USER, externo: "usuario-fora-do-projeto" },
  { papel: "tech lead", permitido: LEAD, externo: "lider-fora-do-projeto" },
];
const PERGUNTA = "PERGUNTA CONFIDENCIAL: qual a arquitetura do Cliente Sigiloso?";

function preparar() {
  const people = [
    { id: USER, role: "po" as const },
    { id: LEAD, role: "tech_lead" as const },
  ];
  const source = new MemoryDemandSource([
    { key: "PROJ-1", title: "Conexão com banco", status: "Em Andamento", assignee: USER },
  ]);
  const enviar = vi.spyOn(source, "addComment");
  const events = new EventLog();
  const config = testProjectConfig({ people });
  const writer = createEffectWriter({ config, source, events, transitionLimit: "in_progress" });
  const channel = createCardCommentChannel({ source, writer });
  return { channel, source, enviar, events, people };
}

function conferirAviso(events: EventLog, destinatario: string) {
  const bloqueios = events.list().filter((evento) => evento.type === "blocked");
  expect(bloqueios).toHaveLength(1);
  const aviso = bloqueios[0];
  if (aviso.type !== "blocked") throw new Error("Aviso de bloqueio ausente");
  expect(aviso).toMatchObject({ project: "exemplo", target: "PROJ-1", action: "mention" });
  expect(aviso.reason).toContain(destinatario);
  expect(aviso.reason).toMatch(/pessoas do projeto/i);
  expect(aviso.reason).not.toContain(PERGUNTA);
  expect(aviso.reason).not.toContain("Cliente Sigiloso");
}

describe("guardrail no Channel realmente usado nos envios", () => {
  it.each(papeis)("envia a pergunta ao $papel quando a pessoa pertence ao projeto", async ({ permitido }) => {
    const { channel, source, enviar, events } = preparar();

    const ref = await channel.ask({ card: "PROJ-1", to: permitido, text: PERGUNTA });

    expect(ref).toMatchObject({ card: "PROJ-1", to: permitido });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(source.commentsOf("PROJ-1")[0].body).toContain(PERGUNTA);
    expect(events.list().filter((evento) => evento.type === "blocked")).toEqual([]);
  });

  it.each(papeis)("bloqueia o $papel externo com aviso antes de qualquer envio", async ({ externo }) => {
    const { channel, source, enviar, events } = preparar();

    await expect(channel.ask({ card: "PROJ-1", to: externo, text: PERGUNTA })).rejects.toThrow(/bloquead/i);

    expect(enviar).not.toHaveBeenCalled();
    expect(source.commentsOf("PROJ-1")).toEqual([]);
    conferirAviso(events, externo);
  });

  it.each(papeis)(
    "conteúdo já enviado não autoriza a mesma pergunta a um $papel externo",
    async ({ permitido, externo }) => {
      const { channel, source, enviar, events } = preparar();
      await channel.ask({ card: "PROJ-1", to: permitido, text: PERGUNTA });
      const antes = source.commentsOf("PROJ-1").map((comentario) => ({ ...comentario }));
      enviar.mockClear();

      await expect(channel.ask({ card: "PROJ-1", to: externo, text: PERGUNTA })).rejects.toThrow(/bloquead/i);

      expect(enviar).not.toHaveBeenCalled();
      expect(source.commentsOf("PROJ-1")).toEqual(antes);
      conferirAviso(events, externo);
    },
  );

  it.each(papeis)(
    "revalida a autorização do $papel revogado antes de reconhecer um envio repetido",
    async ({ permitido }) => {
      const { channel, source, enviar, events, people } = preparar();
      await channel.ask({ card: "PROJ-1", to: permitido, text: PERGUNTA });
      const antes = source.commentsOf("PROJ-1").map((comentario) => ({ ...comentario }));
      people.splice(people.findIndex((pessoa) => pessoa.id === permitido), 1);
      enviar.mockClear();

      await expect(channel.ask({ card: "PROJ-1", to: permitido, text: PERGUNTA })).rejects.toThrow(/bloquead/i);

      expect(enviar).not.toHaveBeenCalled();
      expect(source.commentsOf("PROJ-1")).toEqual(antes);
      conferirAviso(events, permitido);
    },
  );
});
