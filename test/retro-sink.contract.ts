import { beforeAll, describe, expect, it } from "vitest";
import type { RetroSink } from "../src/retro-sink.js";

export interface RetroSinkContractFixture {
  sink: RetroSink;
  /** Repositório (`dono/nome`) onde a suíte pode criar issues. */
  repo: string;
  /**
   * Semeia uma issue que o `listOpen` não deve devolver (fechada, ou sem a label `retro`). Só os fakes semeiam;
   * contra o GitHub real, esses casos ficam de fora.
   */
  seedHidden?: (title: string, kind: "fechada" | "sem-label") => Promise<void>;
}

/**
 * Suíte de contrato única do `RetroSink`: roda contra o fake em memória e o adaptador `gh` com um `gh` falso na CI, e
 * contra o GitHub real só opt-in, num repositório de teste explícito.
 */
export function describeRetroSinkContract(
  suiteName: string,
  setup: () => Promise<RetroSinkContractFixture> | RetroSinkContractFixture,
): void {
  describe(`Contrato RetroSink: ${suiteName}`, () => {
    let fixture: RetroSinkContractFixture;
    const stamp = `${Date.now().toString(36)}`;

    beforeAll(async () => {
      fixture = await setup();
    });

    it("create abre uma issue que o listOpen devolve, com título, corpo, número e URL", async () => {
      const title = `Contrato retro ${stamp}: criar`;
      const created = await fixture.sink.create(fixture.repo, { title, body: "Corpo da issue de contrato." });

      expect(Number.isInteger(created.number)).toBe(true);
      expect(created.url).toMatch(new RegExp(`/issues/${created.number}$`));
      const listed = (await fixture.sink.listOpen(fixture.repo)).find((i) => i.number === created.number);
      expect(listed).toMatchObject({ title, body: "Corpo da issue de contrato.", url: created.url, comments: [] });
    });

    it("comment acrescenta um comentário que o listOpen devolve na issue", async () => {
      const created = await fixture.sink.create(fixture.repo, {
        title: `Contrato retro ${stamp}: comentar`,
        body: "b",
      });

      await fixture.sink.comment(fixture.repo, created.number, "+1 do contrato");

      const listed = (await fixture.sink.listOpen(fixture.repo)).find((i) => i.number === created.number);
      expect(listed?.comments).toEqual(["+1 do contrato"]);
    });

    it("listOpen ignora issues fechadas e sem a label retro", async (ctx) => {
      if (!fixture.seedHidden) return ctx.skip();
      await fixture.seedHidden(`Contrato retro ${stamp}: fechada`, "fechada");
      await fixture.seedHidden(`Contrato retro ${stamp}: sem label`, "sem-label");

      const titles = (await fixture.sink.listOpen(fixture.repo)).map((i) => i.title);
      expect(titles).not.toContain(`Contrato retro ${stamp}: fechada`);
      expect(titles).not.toContain(`Contrato retro ${stamp}: sem label`);
    });

    it("comentar numa issue inexistente falha", async () => {
      await expect(fixture.sink.comment(fixture.repo, 987_654_321, "x")).rejects.toThrow();
    });
  });
}
