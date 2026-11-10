import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { api, startTestFactory, type TestFactory } from "./harness.js";

// Critérios dos tickets 01 e 10 que só estavam cobertos de forma indireta.
describe("critérios de aceite: tipo desconhecido e repositórios já salvos", () => {
  let f: TestFactory | undefined;
  let tmp: string | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("(01) um tipo de Fonte desconhecido na configuração é recusado com mensagem que aponta o campo", async () => {
    f = await startTestFactory({});
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await fetch(`${f.url}/projetos/exemplo/configuracao`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...atual, source: { type: "trello", project: "X", assignee: "y" } }),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/source/);
  });

  it("(10) repositórios já salvos continuam depois de editar outro campo do projeto", async () => {
    tmp = await mkdtemp(join(tmpdir(), "fabrica-repo-"));
    f = await startTestFactory({
      config: {
        name: "exemplo",
        repositories: [
          { path: tmp, prefix: "[m]", test: { command: ["npm", "test"], timeoutSeconds: 300, files: ["**/*.test.*"] } },
        ],
      } as never,
    });
    const antes = await api<{ repositories: { path: string }[] }>(f, "GET", "/projetos/exemplo/configuracao");
    expect(antes.repositories[0]?.path).toBe(tmp);

    await api(f, "PUT", "/projetos/exemplo/configuracao", { ...antes, dryRun: true });

    const depois = await api<{ repositories: { path: string }[]; dryRun: boolean }>(
      f,
      "GET",
      "/projetos/exemplo/configuracao",
    );
    expect(depois.repositories).toEqual(antes.repositories);
    expect(depois.dryRun).toBe(true);
  });
});
