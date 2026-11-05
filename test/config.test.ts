import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDaemon } from "../src/daemon.js";
import type { RunningFactory } from "../src/factory.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";

let dir: string;
let daemon: RunningFactory | undefined;
const source = new MemoryDemandSource([{ key: "PROJ-7", title: "t", status: "A Fazer", assignee: "seu-id-no-jira" }]);
const sources = { jira: () => source };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fabrica-config-"));
});
afterEach(async () => {
  await daemon?.close();
  daemon = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe("config de projeto", () => {
  it("o exemplo do repositório é válido e o daemon sobe com ele", async () => {
    await writeFile(join(dir, "exemplo.yaml"), await readFile("projects/example.yaml", "utf8"));

    daemon = await startDaemon({ configDir: dir, sources });
    const queue = (await (await fetch(`${daemon.url}/queue`)).json()) as { key: string }[];

    expect(queue.map((c) => c.key)).toEqual(["PROJ-7"]);
  });

  it("recusa iniciar com config inválida, dizendo arquivo, campo e motivo", async () => {
    await writeFile(
      join(dir, "quebrado.yaml"),
      "name: quebrado\nsource:\n  type: jira\n  project: PROJ\nstatuses:\n  A Fazer: fazendo\n",
    );

    const start = startDaemon({ configDir: dir, sources });

    await expect(start).rejects.toThrow(/quebrado\.yaml/);
    await expect(start).rejects.toThrow(/source\.assignee/);
    await expect(start).rejects.toThrow(/statuses\.A Fazer/);
  });

  it("recusa iniciar sem nenhum projeto configurado", async () => {
    await expect(startDaemon({ configDir: dir, sources })).rejects.toThrow(/nenhum projeto/i);
  });
});
