import { describe, expect, it } from "vitest";
import { createEffectWriter } from "../src/effect-writer.js";
import { EventLog } from "../src/events.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";
import { testProjectConfig, USER } from "./harness.js";

// O Jira devolve os parágrafos sem a linha em branco que a fábrica escreveu. Uma escrita repetida não pode criar
// outro comentário por causa disso (ADR-0020).
describe("deduplicação de comentário quando a Fonte perde a linha em branco", () => {
  it("commentOnce reconhece o próprio comentário mesmo com parágrafos sem linha em branco", async () => {
    const source = new MemoryDemandSource([{ key: "PROJ-1", title: "t", status: "A Fazer", assignee: USER }]);
    const events = new EventLog();
    const writer = createEffectWriter({
      config: testProjectConfig({ dryRun: false }),
      source,
      events,
      transitionLimit: "in_progress",
    });
    const { id } = await source.addComment("PROJ-1", "Título\nnovo\n\n*mensagem automatizada*");

    const repetido = await writer.commentOnce("PROJ-1", "Título\n\nnovo");

    expect(repetido.id).toBe(id);
    expect(source.commentsOf("PROJ-1")).toHaveLength(1);
  });
});
