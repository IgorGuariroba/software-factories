import { afterEach, beforeEach, expect, it } from "vitest";
import { defaultBranch } from "../src/git.js";
import { createRemoteRepo, git, removeTempRoot, tempRoot } from "./fakes/git-repos.js";

let root: string;
beforeEach(async () => {
  root = await tempRoot();
});
afterEach(() => removeTempRoot(root));

it("descobre a branch padrão mesmo com origin/HEAD pendente ou ausente no clone", async () => {
  const repo = await createRemoteRepo(root, "app");
  await git(repo.user, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/sumiu");
  expect(await defaultBranch(repo.user)).toBe("main");
  await git(repo.user, "update-ref", "-d", "--no-deref", "refs/remotes/origin/HEAD");
  expect(await defaultBranch(repo.user)).toBe("main");
});
