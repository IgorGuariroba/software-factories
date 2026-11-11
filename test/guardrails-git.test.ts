import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEffectWriter } from "../src/effect-writer.js";
import { EventLog } from "../src/events.js";
import { GuardrailViolation } from "../src/marca-automacao.js";
import { FakeCodeHost } from "./fakes/fake-code-host.js";
import { createRemoteRepo, git, type RemoteRepo, removeTempRoot, tempRoot } from "./fakes/git-repos.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";
import { testProjectConfig } from "./harness.js";

const FACTORY_BRANCH = "feature/PROJ-1-exportar";

let root: string;
let repo: RemoteRepo;
beforeEach(async () => {
  root = await tempRoot();
  repo = await createRemoteRepo(root, "app", { branches: ["feature/alheia"] });
  // Uma branch da fábrica e uma alheia, com um commit novo em cada, no clone que faz o push.
  for (const branch of [FACTORY_BRANCH, "feature/alheia"]) {
    await git(repo.user, "checkout", "--quiet", "-B", branch);
    await git(repo.user, "commit", "--quiet", "--allow-empty", "-m", `feat: commit em ${branch}`);
  }
  await git(repo.user, "checkout", "--quiet", "main");
  await git(repo.user, "commit", "--quiet", "--allow-empty", "-m", "feat: commit local na main");
});
afterEach(() => removeTempRoot(root));

function setup(opts: { dryRun?: boolean } = {}) {
  const events = new EventLog();
  const codeHost = new FakeCodeHost();
  const writer = createEffectWriter({
    config: testProjectConfig({ dryRun: opts.dryRun ?? false }),
    source: new MemoryDemandSource(),
    events,
    transitionLimit: "in_progress",
    codeHost,
    isFactoryBranch: (branch) => branch === FACTORY_BRANCH,
  });
  return { events, codeHost, writer };
}

describe("guardrails de git no escritor de efeitos", () => {
  it("push em main, master ou develop é bloqueado e avisado, também com force e com refs/heads/", async () => {
    const { events, codeHost, writer } = setup();
    const mainBefore = await git(repo.bare, "rev-parse", "main");

    for (const branch of ["main", "master", "develop", "refs/heads/main"]) {
      await expect(writer.pushBranch(repo.user, branch)).rejects.toThrow(GuardrailViolation);
    }
    await expect(writer.pushBranch(repo.user, "main", { force: true })).rejects.toThrow(GuardrailViolation);

    expect(codeHost.pushed).toEqual([]);
    expect(await git(repo.bare, "rev-parse", "main")).toBe(mainBefore);
    expect(events.list().map((e) => e.type === "blocked" && e.target)).toEqual([
      "main",
      "master",
      "develop",
      "main",
      "main",
    ]);
  });

  it("force-push fora das branches da fábrica é bloqueado e avisado", async () => {
    const { events, codeHost, writer } = setup();
    const before = await git(repo.bare, "rev-parse", "feature/alheia");

    await expect(writer.pushBranch(repo.user, "feature/alheia", { force: true })).rejects.toThrow(/force-push/);

    expect(codeHost.pushed).toEqual([]);
    expect(await git(repo.bare, "rev-parse", "feature/alheia")).toBe(before);
    expect(events.list()).toMatchObject([{ type: "blocked", action: "force-push", target: "feature/alheia" }]);
  });

  it("push e force-push na branch da fábrica vão para o remoto, só essa branch", async () => {
    const { events, writer } = setup();
    const mainBefore = await git(repo.bare, "rev-parse", "main");

    await writer.pushBranch(repo.user, FACTORY_BRANCH);
    expect(await git(repo.bare, "rev-parse", FACTORY_BRANCH)).toBe(await git(repo.user, "rev-parse", FACTORY_BRANCH));

    // Reescreve a branch e força: permitido só porque é da fábrica.
    await git(repo.user, "checkout", "--quiet", FACTORY_BRANCH);
    await git(repo.user, "commit", "--quiet", "--amend", "--allow-empty", "-m", "feat: reescrito");
    await writer.pushBranch(repo.user, FACTORY_BRANCH, { force: true });

    expect(await git(repo.bare, "log", "-1", "--format=%s", FACTORY_BRANCH)).toBe("feat: reescrito");
    expect(await git(repo.bare, "rev-parse", "main")).toBe(mainBefore);
    expect(events.list().map((e) => e.type === "write" && e.action)).toEqual(["push", "force-push"]);
  });

  it("no dry-run o push é registrado e nada chega ao remoto", async () => {
    const { events, codeHost, writer } = setup({ dryRun: true });

    await writer.pushBranch(repo.user, FACTORY_BRANCH);

    expect(codeHost.pushed).toEqual([]);
    expect(await repo.branches()).toEqual(["feature/alheia", "main"]);
    expect(events.list()).toMatchObject([{ type: "write", action: "push", target: FACTORY_BRANCH, dryRun: true }]);
  });
});
