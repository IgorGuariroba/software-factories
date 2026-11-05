import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemandSource } from "../src/demand-source.js";

export interface DemandSourceContractFixture {
  source: DemandSource;
  project: string;
  assignee: string;
  existingCardKey: string;
  /** Parâmetros de transição para o teste de transição (opcional se o ambiente for só de leitura). */
  transition?: {
    fromStatus: string;
    toStatus: string;
  };
  cleanup?: () => Promise<void>;
}

/**
 * Suíte de contrato única que valida qualquer implementação de `DemandSource`.
 * Roda contra o fake em memória (`MemoryDemandSource`) na CI e contra o Jira real (`JiraDemandSource`) opt-in.
 */
export function describeDemandSourceContract(
  suiteName: string,
  setup: () => Promise<DemandSourceContractFixture> | DemandSourceContractFixture,
): void {
  describe(`Contrato DemandSource: ${suiteName}`, () => {
    let fixture: DemandSourceContractFixture;

    beforeAll(async () => {
      fixture = await setup();
    });

    afterAll(async () => {
      if (fixture?.cleanup) await fixture.cleanup();
    });

    it("listAssignedCards retorna cards atribuídos ao usuário no projeto e exclui outros", async () => {
      const cards = await fixture.source.listAssignedCards(fixture.assignee);
      expect(Array.isArray(cards)).toBe(true);

      for (const card of cards) {
        expect(card.key).toMatch(new RegExp(`^${fixture.project}-\\d+$`));
        expect(card.assignee).toBe(fixture.assignee);
        expect(typeof card.title).toBe("string");
        expect(card.title.length).toBeGreaterThan(0);
        expect(typeof card.status).toBe("string");
        expect(card.status.length).toBeGreaterThan(0);
      }
    });

    it("getCard retorna os dados do card existente e undefined para card inexistente ou de outro projeto", async () => {
      const card = await fixture.source.getCard(fixture.existingCardKey);
      expect(card).toBeDefined();
      expect(card?.key).toBe(fixture.existingCardKey);
      expect(typeof card?.title).toBe("string");
      expect(typeof card?.status).toBe("string");
      expect(typeof card?.assignee).toBe("string");

      const notFound = await fixture.source.getCard(`${fixture.project}-9999999`);
      expect(notFound).toBeUndefined();

      const otherProject = await fixture.source.getCard("OUTROPROJ-1");
      expect(otherProject).toBeUndefined();
    });

    it("listComments lista os comentários com id, author e body", async () => {
      const comments = await fixture.source.listComments(fixture.existingCardKey);
      expect(Array.isArray(comments)).toBe(true);
      for (const comment of comments) {
        expect(typeof comment.id).toBe("string");
        expect(typeof comment.author).toBe("string");
        expect(typeof comment.body).toBe("string");
      }
    });

    it("listTextAttachments lista apenas anexos de texto com name e content", async () => {
      const attachments = await fixture.source.listTextAttachments(fixture.existingCardKey);
      expect(Array.isArray(attachments)).toBe(true);
      for (const att of attachments) {
        expect(typeof att.name).toBe("string");
        expect(typeof att.content).toBe("string");
        // Não deve retornar binários como png, jpg, pdf, zip
        expect(att.name).not.toMatch(/\.(png|jpe?g|gif|webp|pdf|zip|tar|gz|bin|exe)$/i);
      }
    });

    it("formatMention formata menção contendo o identificador da pessoa", () => {
      const mention = fixture.source.formatMention("pessoa-123");
      expect(typeof mention).toBe("string");
      expect(mention).toContain("pessoa-123");
    });

    it("addComment cria comentário próprio (com suporte a menção) e editComment edita no lugar", async () => {
      const mention = fixture.source.formatMention("qa-lead");
      const initialText = `[contrato-teste] Dúvida sobre o card para ${mention} (ts=${Date.now()})`;

      const { id } = await fixture.source.addComment(fixture.existingCardKey, initialText);
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);

      const afterAdd = await fixture.source.listComments(fixture.existingCardKey);
      const created = afterAdd.find((c) => c.id === id);
      expect(created).toBeDefined();
      expect(created?.body).toContain(initialText);
      // O comentário próprio é reconhecido como do usuário: o escritor de efeitos depende disso para não duplicar.
      expect(created?.author).toBe(fixture.assignee);

      const updatedText = `[contrato-teste] Atualizado (ts=${Date.now()})`;
      await fixture.source.editComment(fixture.existingCardKey, id, updatedText);

      const afterEdit = await fixture.source.listComments(fixture.existingCardKey);
      const updated = afterEdit.find((c) => c.id === id);
      expect(updated).toBeDefined();
      expect(updated?.body).toContain(updatedText);
    });

    it("transition move o card para outro status", async () => {
      if (!fixture.transition) return;
      const { toStatus, fromStatus } = fixture.transition;

      await fixture.source.transition(fixture.existingCardKey, toStatus);
      const moved = await fixture.source.getCard(fixture.existingCardKey);
      expect(moved?.status).toBe(toStatus);

      // Restaura o status inicial
      await fixture.source.transition(fixture.existingCardKey, fromStatus);
      const restored = await fixture.source.getCard(fixture.existingCardKey);
      expect(restored?.status).toBe(fromStatus);
    });
  });
}
