import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { api, startTestFactory, type TestFactory } from "./harness.js";

describe("repositórios locais editáveis pela interface, com validação (fatia 10)", () => {
  let f: TestFactory | undefined;
  let tmp: string | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("recusa um caminho de repositório que não existe, com mensagem clara", async () => {
    f = await startTestFactory({ config: { name: "exemplo" } });
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await fetch(`${f.url}/projetos/exemplo/configuracao`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...atual,
        repositories: [{ path: "/caminho/que/nao/existe/xyz", prefix: "PROJ", test: { command: ["npm", "test"] } }],
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("caminho do repositório não existe");
  });

  it("aceita um caminho existente e devolve a configuração salva", async () => {
    tmp = await mkdtemp(join(tmpdir(), "fabrica-repo-"));
    f = await startTestFactory({ config: { name: "exemplo" } });
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");

    const salvo = await api<{ repositories: { path: string }[] }>(f, "PUT", "/projetos/exemplo/configuracao", {
      ...atual,
      repositories: [{ path: tmp, prefix: "PROJ", test: { command: ["npm", "test"] } }],
    });

    expect(salvo.repositories[0]?.path).toBe(tmp);
  });

  it("recusa o comando de teste como texto: ele é uma lista de argumentos, sem shell", async () => {
    f = await startTestFactory({ config: { name: "exemplo" } });
    const atual = await api<Record<string, unknown>>(f, "GET", "/projetos/exemplo/configuracao");

    const res = await fetch(`${f.url}/projetos/exemplo/configuracao`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...atual,
        repositories: [{ path: tmp ?? "/", prefix: "PROJ", test: { command: "npm test" } }],
      }),
    });

    expect(res.status).toBe(400);
  });
});
