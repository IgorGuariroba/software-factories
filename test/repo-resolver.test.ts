import { describe, expect, it } from "vitest";
import { DEFAULT_TEST_FILES } from "../src/config.js";
import { resolveRepository } from "../src/repo-resolver.js";

describe("resolução de repositório", () => {
  const test = { command: ["npm", "test"], timeoutSeconds: 60, files: DEFAULT_TEST_FILES };
  const repositories = [
    { path: "/repos/frontend", prefix: "[front]", test },
    { path: "/repos/backend", prefix: "BE-", test },
    { path: "/repos/mobile", board: "Mobile Board", test },
  ];

  it("resolve por prefixo no título do card", () => {
    const repo = resolveRepository(repositories, {
      key: "PROJ-1",
      title: "[front] Tela de login",
    });
    expect(repo?.path).toBe("/repos/frontend");
  });

  it("resolve por prefixo na chave do card", () => {
    const repo = resolveRepository(repositories, {
      key: "BE-42",
      title: "Criar endpoint de autenticação",
    });
    expect(repo?.path).toBe("/repos/backend");
  });

  it("resolve por board do card", () => {
    const repo = resolveRepository(repositories, {
      key: "PROJ-99",
      title: "Notificações push",
      board: "Mobile Board",
    });
    expect(repo?.path).toBe("/repos/mobile");
  });

  it("retorna undefined quando nenhum repositório corresponde", () => {
    const repo = resolveRepository(repositories, {
      key: "INFRA-10",
      title: "Provisionar bucket S3",
      board: "DevOps",
    });
    expect(repo).toBeUndefined();
  });

  it("retorna undefined quando lista de repositórios é vazia ou indefinida", () => {
    expect(resolveRepository(undefined, { key: "PROJ-1", title: "Qualquer" })).toBeUndefined();
    expect(resolveRepository([], { key: "PROJ-1", title: "Qualquer" })).toBeUndefined();
  });
});
