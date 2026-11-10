import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSecretStore } from "../src/packages/secret-store/index.js";

describe("SecretStore: credenciais guardadas cifradas, sem exibir o valor", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fabrica-segredos-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("guarda um valor e o devolve para uso interno", async () => {
    const store = createSecretStore({ dir });
    await store.put("jira-token", "tok-abc-123");

    expect(await store.get("jira-token")).toBe("tok-abc-123");
    expect(await store.has("jira-token")).toBe(true);
  });

  it("listar mostra só o nome e a data, nunca o valor", async () => {
    const store = createSecretStore({ dir });
    await store.put("jira-token", "tok-abc-123");

    const listados = await store.list();

    expect(listados.map((s) => s.nome)).toEqual(["jira-token"]);
    expect(typeof listados[0]?.atualizadoEm).toBe("string");
    expect(JSON.stringify(listados)).not.toContain("tok-abc-123");
  });

  it("não grava o valor em texto puro no disco", async () => {
    const store = createSecretStore({ dir });
    await store.put("jira-token", "tok-abc-123");

    const conteudo = await readFile(join(dir, "segredos.json"), "utf8");

    expect(conteudo).not.toContain("tok-abc-123");
  });

  it("sobrevive a um reinício: outra instância sobre o mesmo diretório lê o valor", async () => {
    await createSecretStore({ dir }).put("gitlab-token", "glpat-xyz");

    expect(await createSecretStore({ dir }).get("gitlab-token")).toBe("glpat-xyz");
  });

  it("trocar o valor substitui o anterior", async () => {
    const store = createSecretStore({ dir });
    await store.put("jira-token", "antigo");
    await store.put("jira-token", "novo");

    expect(await store.get("jira-token")).toBe("novo");
    expect(await store.list()).toHaveLength(1);
  });

  it("nome desconhecido não existe e não tem valor", async () => {
    const store = createSecretStore({ dir });

    expect(await store.has("nao-existe")).toBe(false);
    expect(await store.get("nao-existe")).toBeUndefined();
  });

  it("a chave de cifragem é criada com permissão restrita ao dono", async () => {
    const store = createSecretStore({ dir });
    await store.put("jira-token", "tok");

    const modo = (await stat(join(dir, "chave.bin"))).mode & 0o777;

    expect(modo).toBe(0o600);
  });
});
