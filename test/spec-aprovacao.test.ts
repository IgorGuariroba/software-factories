import { afterEach, describe, expect, it } from "vitest";
import { api, eventually, poll, startTestFactory, type TestFactory, USER, waitForStatus } from "./harness.js";

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

const PREFIX = "\u{1F916} [mensagem automatizada]";
const card = { key: "PROJ-1", title: "Exportar relatório", status: "A Fazer", assignee: USER };
const titled = (f: TestFactory, title: string) =>
  f.source.commentsOf("PROJ-1").filter((c) => c.body.split("\n")[0] === `${PREFIX} ${title}`);

interface SpecPreview {
  spec: string;
  tickets: string;
  dryRun: boolean;
  revision: string;
}

const approve = (f: TestFactory, revision: string) =>
  fetch(`${f.url}/tasks/exemplo/PROJ-1/spec/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision }),
  });

describe("revisão da SPEC antes de publicar", () => {
  it("segura SPEC e Tickets até a aprovação da prévia exata, inclusive após reinício", async () => {
    factory = await startTestFactory({ cards: [card], config: { specApproval: true } });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    expect(titled(factory, "SPEC")).toEqual([]);
    expect(titled(factory, "Tickets")).toEqual([]);

    factory = await factory.restart();
    await poll(factory);
    expect(titled(factory, "SPEC")).toEqual([]);

    const preview = await api<SpecPreview>(factory, "GET", "/tasks/exemplo/PROJ-1/spec");
    expect(preview.spec.startsWith(`${PREFIX} SPEC`)).toBe(true);
    expect((await approve(factory, "inválida")).status).toBe(409);
    expect(titled(factory, "SPEC")).toEqual([]);

    expect((await approve(factory, preview.revision)).status).toBe(200);
    await waitForStatus(factory, "PROJ-1", "concluida");
    expect(titled(factory, "SPEC").map((c) => c.body)).toEqual([preview.spec]);
    expect(titled(factory, "Tickets").map((c) => c.body)).toEqual([preview.tickets]);
    expect((await approve(factory, preview.revision)).status).toBe(409);
  });

  it("não publica a SPEC aprovada em dry-run", async () => {
    factory = await startTestFactory({ dryRun: true, cards: [card], config: { specApproval: true } });
    await poll(factory);
    await waitForStatus(factory, "PROJ-1", "aguardando-humano");
    const preview = await api<SpecPreview>(factory, "GET", "/tasks/exemplo/PROJ-1/spec");
    expect(preview.dryRun).toBe(true);
    expect((await approve(factory, preview.revision)).status).toBe(409);
    await eventually(() => expect(factory?.source.commentsOf("PROJ-1")).toEqual([]));
  });
});
