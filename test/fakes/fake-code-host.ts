import type { ChangeRequest, CodeHost, RequestDraft } from "../../src/code-host.js";
import { discoverGitConventions } from "../../src/conventions.js";
import { git } from "../../src/git.js";
import { pushOneBranch } from "../../src/git-code-host.js";

/**
 * O "GitLab" dos testes: o remoto é um repositório bare temporário, então o push é git de verdade contra ele.
 * Registra cada push para o teste conferir o que a fábrica enviou (ou, no dry-run, que não enviou nada).
 */
export class FakeCodeHost implements CodeHost {
  readonly pushed: { repoPath: string; branch: string; force: boolean }[] = [];
  requestState: ChangeRequest["state"] = "merged";
  checks: ChangeRequest["checks"] = "passed";
  conflicts = false;
  feedback: ChangeRequest["feedback"] = [];
  readonly openedRequests: RequestDraft[] = [];
  private requestBranches = new Map<string, number>();

  async ensureRequest(repoPath: string, draft: RequestDraft): Promise<ChangeRequest> {
    const key = `${repoPath}:${draft.branch}`;
    let number = this.requestBranches.get(key);
    if (!number) {
      number = this.openedRequests.push(draft);
      this.requestBranches.set(key, number);
    }
    return this.inspectRequest(repoPath, number);
  }

  async inspectRequest(repoPath: string, number: number): Promise<ChangeRequest> {
    const draft = this.openedRequests[number - 1];
    if (!draft) throw new Error("PR inexistente");
    return {
      number,
      url: `https://code.test/pull/${number}`,
      head: (await git(repoPath, ["rev-parse", draft.branch])).trim(),
      state: this.requestState,
      checks: this.checks,
      conflicts: this.conflicts,
      feedback: [...this.feedback],
    };
  }

  discoverConventions(repoPath: string) {
    return discoverGitConventions(repoPath);
  }

  async pushBranch(repoPath: string, branch: string, opts?: { force?: boolean }): Promise<void> {
    const force = opts?.force ?? false;
    await pushOneBranch(repoPath, branch, force);
    this.pushed.push({ repoPath, branch, force });
  }
}
