import { afterEach, describe, expect, it } from "vitest";
import { git } from "../src/git.js";
import { createRemoteRepo, removeTempRoot, tempRoot, git as testGit } from "./fakes/git-repos.js";

// Dentro de um hook do git (ex.: pre-push rodando `npm test` num worktree) o ambiente traz GIT_DIR e afins apontando
// para o repositório do hook. Herdados, eles fariam o git da fábrica e dos testes agir nesse repositório, e não no `cwd`.
const saved = { ...process.env };
let root: string | undefined;
afterEach(async () => {
  process.env = { ...saved };
  if (root) await removeTempRoot(root);
  root = undefined;
});

describe("git ignora o repositório do ambiente", () => {
  it("com GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE de outro repositório, age no cwd", async () => {
    root = await tempRoot();
    const alvo = await createRemoteRepo(root, "alvo");
    const alheio = await createRemoteRepo(root, "alheio");
    process.env.GIT_DIR = `${alheio.user}/.git`;
    process.env.GIT_WORK_TREE = alheio.user;
    process.env.GIT_INDEX_FILE = `${alheio.user}/.git/index`;

    await git(alvo.user, ["switch", "-c", "fabrica/teste"]);
    await testGit(alvo.user, "switch", "-c", "teste/fake");

    delete process.env.GIT_DIR;
    delete process.env.GIT_WORK_TREE;
    delete process.env.GIT_INDEX_FILE;
    expect(await testGit(alvo.user, "branch", "--show-current")).toBe("teste/fake");
    expect(await testGit(alheio.user, "branch", "--list", "fabrica/teste", "teste/fake")).toBe("");
  });

  it("descarta da configuração herdada o que redireciona o git (core.worktree, pushurl), por COUNT e PARAMETERS", async () => {
    root = await tempRoot();
    const alvo = await createRemoteRepo(root, "alvo");
    const alheio = await createRemoteRepo(root, "alheio");
    process.env.GIT_CONFIG_COUNT = "2";
    process.env.GIT_CONFIG_KEY_0 = "core.worktree";
    process.env.GIT_CONFIG_VALUE_0 = alheio.user;
    process.env.GIT_CONFIG_KEY_1 = "safe.directory";
    process.env.GIT_CONFIG_VALUE_1 = "*";
    process.env.GIT_CONFIG_PARAMETERS = `'remote.origin.pushurl'='${alheio.bare}'`;

    expect(await git(alvo.user, ["config", "--get-all", "safe.directory"]).catch(() => "")).toContain("*");
    expect(await git(alvo.user, ["config", "core.worktree"]).catch(() => "")).toBe("");
    expect(await git(alvo.user, ["config", "remote.origin.pushurl"]).catch(() => "")).toBe("");
    await git(alvo.user, ["switch", "-c", "teste/push"]);
    await git(alvo.user, ["commit", "--allow-empty", "-m", "teste"]);
    await git(alvo.user, ["push", "-q", "origin", "teste/push"]);
    expect(await alheio.branches()).not.toContain("teste/push");
    expect(await alvo.branches()).toContain("teste/push");
  });

  it("a suíte não enxerga a configuração git global nem a do sistema da máquina", async () => {
    root = await tempRoot();
    const alvo = await createRemoteRepo(root, "alvo");
    // A configuração efetiva, com o escopo de cada entrada: nada pode vir de `global` nem de `system`.
    const scopes = (await git(alvo.user, ["config", "--list", "--show-scope"]))
      .split("\n")
      .map((l) => l.split("\t")[0]);
    expect(scopes.filter((s) => s === "global" || s === "system")).toEqual([]);
  });
});
