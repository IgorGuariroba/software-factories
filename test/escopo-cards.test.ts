import { expect, it } from "vitest";
import { api, poll, startTestFactory, USER, waitForStatus } from "./harness.js";

it("com lista explícita, a fábrica só enfileira e escreve no card autorizado", async () => {
  const factory = await startTestFactory({
    cards: [
      { key: "PROJ-1", title: "autorizado", status: "A Fazer", assignee: USER },
      { key: "PROJ-2", title: "fora do escopo", status: "A Fazer", assignee: USER },
    ],
    config: { source: { type: "jira", project: "PROJ", assignee: USER, keys: ["PROJ-1"] } },
  });
  try {
    const queue = await api<{ key: string }[]>(factory, "GET", "/queue");
    expect(queue.map((item) => item.key)).toEqual(["PROJ-1"]);
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(factory.source.commentsOf("PROJ-2")).toEqual([]);
    expect(factory.source.cards.find((card) => card.key === "PROJ-2")?.status).toBe("A Fazer");
  } finally {
    await factory.close();
  }
});
