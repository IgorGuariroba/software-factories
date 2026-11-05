import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodeHost } from "../src/code-host.js";
import { gitCodeHost } from "../src/git-code-host.js";
import { FakeCodeHost } from "./fakes/fake-code-host.js";
import { createRemoteRepo, git, type RemoteRepo, removeTempRoot, tempRoot } from "./fakes/git-repos.js";

/** O mesmo contrato contra o fake e contra o adaptador git (o remoto é um bare local, então roda sempre). */
describe.each([
  ["FakeCodeHost", () => new FakeCodeHost()],
  ["gitCodeHost", () => gitCodeHost],
] as [string, () => CodeHost][])("contrato do CodeHost: %s", (_name, make) => {
  let root: string;
  let repo: RemoteRepo;
  beforeEach(async () => {
    root = await tempRoot();
    repo = await createRemoteRepo(root, "app", {
      commits: ["feat: tela de login (ABC-1)", "fix: valida a senha (ABC-2)"],
      branches: ["feat/ABC-1-tela-de-login"],
    });
  });
  afterEach(() => removeTempRoot(root));

  it("descobre as convenções de branch e commit no histórico", async () => {
    await git(repo.user, "fetch", "--quiet", "origin");

    expect(await make().discoverConventions(repo.user)).toEqual({
      branch: "feat/{key}-{slug}",
      commit: "{type}: {summary} ({key})",
    });
  });

  it("o push envia só a branch pedida, para a branch de mesmo nome no remoto", async () => {
    await git(repo.user, "checkout", "--quiet", "-b", "feat/PROJ-1-x");
    await git(repo.user, "commit", "--quiet", "--allow-empty", "-m", "feat: x");
    await git(repo.user, "checkout", "--quiet", "main");
    await git(repo.user, "commit", "--quiet", "--allow-empty", "-m", "feat: local na main");
    const mainBefore = await git(repo.bare, "rev-parse", "main");

    await make().pushBranch(repo.user, "feat/PROJ-1-x");

    expect(await git(repo.bare, "rev-parse", "feat/PROJ-1-x")).toBe(await git(repo.user, "rev-parse", "feat/PROJ-1-x"));
    expect(await git(repo.bare, "rev-parse", "main")).toBe(mainBefore);
  });

  it("um push que o remoto recusa falha, em vez de passar calado", async () => {
    // A branch do remoto anda por um lado e a local por outro: o push sem force não é fast-forward.
    await git(repo.user, "checkout", "--quiet", "-b", "outro-lado", "main");
    await git(repo.user, "commit", "--quiet", "--allow-empty", "-m", "feat: outro lado");
    await git(repo.user, "push", "--quiet", "--force", "origin", "outro-lado:refs/heads/feat/ABC-1-tela-de-login");
    await git(repo.user, "checkout", "--quiet", "-b", "feat/ABC-1-tela-de-login", "main");
    await git(repo.user, "commit", "--quiet", "--allow-empty", "-m", "feat: diverge");

    await expect(make().pushBranch(repo.user, "feat/ABC-1-tela-de-login")).rejects.toThrow();
  });
});
