import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { api, startTestFactory, type TestFactory } from "./harness.js";

// Decisão do usuário (ticket 11): o comando de teste de um repositório é obrigatório. Sem ele, a configuração não é
// salva, então a pendência "repositório sem comando de teste" não tem como ocorrer.
describe("repositório sem comando de teste", () => {
  let f: TestFactory | undefined;
  let tmp: string | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("a configuração é recusada quando o repositório não tem comando de teste", async () => {
    tmp = await mkdtemp(join(tmpdir(), "fabrica-repo-"));
    f = await startTestFactory({ config: { name: "exemplo" } });
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await fetch(`${f.url}/projetos/exemplo/configuracao`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...atual, repositories: [{ path: tmp, prefix: "PROJ" }] }),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/test/);
  });
});
