import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ManagementInterface } from "../src/management.js";

export interface ManagementContractFixture {
  /** A interface, publicando na conversa de teste. */
  port: ManagementInterface;
  /** A mesma interface apontando para uma conversa que não existe: publicar falha. */
  unreachable: ManagementInterface;
  /** Credencial que nunca pode aparecer num erro (ex.: o token do bot). */
  secret?: string;
  /** Age como o usuário na conversa; só onde dá para simular (fakes). Sem ele, os testes de recepção são pulados. */
  simulate?: {
    say(text: string): void;
    tap(command: string): void;
    /** Um update que não é comando (ex.: alguém entrou no grupo), onde a interface os tem. */
    other?(): void;
  };
  /** O que chegou à conversa, onde dá para ler (fakes). */
  delivered?: () => string[];
  cleanup?: () => Promise<void>;
}

/** Suíte única da porta `ManagementInterface`: roda contra os fakes na CI e contra o Telegram real só opt-in. */
export function describeManagementContract(
  suiteName: string,
  setup: () => Promise<ManagementContractFixture> | ManagementContractFixture,
): void {
  describe(`Contrato ManagementInterface: ${suiteName}`, () => {
    let fixture: ManagementContractFixture;

    beforeAll(async () => {
      fixture = await setup();
    });
    afterAll(async () => {
      await fixture?.cleanup?.();
    });

    it("publica texto puro, sem interpretar marcação", async () => {
      const text = "Contrato da fábrica: <b>negrito?</b> & _sublinhado_ *estrela* [link](x) `código`";

      await fixture.port.send({ text });

      if (fixture.delivered) expect(fixture.delivered().at(-1)).toBe(text);
    });

    it("publica com botões", async () => {
      await fixture.port.send({
        text: "Contrato da fábrica: mensagem com botões",
        buttons: [
          { label: "Vetar", command: "/vetar exemplo/PROJ-1" },
          { label: "Pausar", command: "/pausar exemplo/PROJ-1" },
        ],
      });

      if (fixture.delivered) expect(fixture.delivered().at(-1)).toBe("Contrato da fábrica: mensagem com botões");
    });

    it("texto acima do limite da interface chega, truncado se preciso", async () => {
      const text = `Contrato da fábrica: texto longo ${"x".repeat(5000)}`;

      await fixture.port.send({ text });

      if (fixture.delivered) expect(fixture.delivered().at(-1)?.startsWith(text.slice(0, 200))).toBe(true);
    });

    it("um botão que a interface não aceita não impede a mensagem", async () => {
      await fixture.port.send({
        text: "Contrato da fábrica: botão com comando longo",
        buttons: [{ label: "Longo", command: `/vetar ${"projeto-de-nome-muito-comprido/".repeat(4)}PROJ-1` }],
      });

      if (fixture.delivered) expect(fixture.delivered().at(-1)).toBe("Contrato da fábrica: botão com comando longo");
    });

    it("uma falha ao publicar rejeita, sem expor credenciais", async () => {
      const error = await fixture.unreachable.send({ text: "não deve chegar" }).then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(Error);
      if (fixture.secret) {
        expect((error as Error).message).not.toContain(fixture.secret);
        expect(String((error as Error).stack)).not.toContain(fixture.secret);
      }
    });

    it("receber termina quando o sinal aborta", async () => {
      const abort = new AbortController();
      setTimeout(() => abort.abort(), 50);

      const updates = await fixture.port.receive(2_147_483_647, abort.signal);

      expect(Array.isArray(updates)).toBe(true);
    });

    it("devolve, em ordem, comandos digitados e toques de botão a partir do offset", async (ctx) => {
      if (!fixture.simulate) return ctx.skip();
      const first = await pending(fixture.port, 0);
      const offset = (first.at(-1)?.id ?? -1) + 1;

      fixture.simulate.say("/pausar PROJ-1");
      fixture.simulate.tap("/vetar exemplo/PROJ-1");
      const updates = await collect(fixture.port, offset, 2);

      expect(updates).toEqual([
        expect.objectContaining({ text: "/pausar PROJ-1", chat: expect.any(String), user: expect.any(String) }),
        expect.objectContaining({ text: "/vetar exemplo/PROJ-1", buttonId: expect.any(String) }),
      ]);
      expect(updates[0]?.buttonId).toBeUndefined();
      expect((updates[1]?.id ?? 0) > (updates[0]?.id ?? 0)).toBe(true);
      await fixture.port.answerButton(updates[1]?.buttonId as string, "Tarefa vetada.");

      expect(await pending(fixture.port, (updates[1]?.id ?? 0) + 1)).toEqual([]);
    });

    it("updates que não são comandos não chegam à fábrica nem travam a recepção", async (ctx) => {
      const simulate = fixture.simulate;
      if (!simulate?.other) return ctx.skip();
      const before = await pending(fixture.port, 0);
      const offset = (before.at(-1)?.id ?? -1) + 1;

      simulate.other();
      expect(await pending(fixture.port, offset)).toEqual([]);
      simulate.say("/retomar");

      expect(await collect(fixture.port, offset, 1)).toEqual([expect.objectContaining({ text: "/retomar" })]);
    });
  });
}

/** O que já está pendente a partir de `offset`, sem esperar por mais. */
async function pending(port: ManagementInterface, offset: number) {
  const abort = new AbortController();
  const stop = setTimeout(() => abort.abort(), 50);
  try {
    return await port.receive(offset, abort.signal);
  } finally {
    clearTimeout(stop);
  }
}

/** Recebe até juntar `count` updates a partir de `offset`. */
async function collect(port: ManagementInterface, offset: number, count: number) {
  const got: Awaited<ReturnType<ManagementInterface["receive"]>> = [];
  const deadline = Date.now() + 3000;
  while (got.length < count && Date.now() < deadline) {
    const abort = new AbortController();
    const stop = setTimeout(() => abort.abort(), 500);
    const next = (got.at(-1)?.id ?? offset - 1) + 1;
    got.push(...(await port.receive(next, abort.signal)));
    clearTimeout(stop);
  }
  return got;
}
