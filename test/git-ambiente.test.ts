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
});
