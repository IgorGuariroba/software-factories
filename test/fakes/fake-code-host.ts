import type { CodeHost } from "../../src/code-host.js";
import { discoverGitConventions } from "../../src/conventions.js";
import { pushOneBranch } from "../../src/git-code-host.js";

/**
 * O "GitLab" dos testes: o remoto é um repositório bare temporário, então o push é git de verdade contra ele.
 * Registra cada push para o teste conferir o que a fábrica enviou (ou, no dry-run, que não enviou nada).
 */
export class FakeCodeHost implements CodeHost {
  readonly pushed: { repoPath: string; branch: string; force: boolean }[] = [];

  discoverConventions(repoPath: string) {
    return discoverGitConventions(repoPath);
  }

  async pushBranch(repoPath: string, branch: string, opts?: { force?: boolean }): Promise<void> {
    const force = opts?.force ?? false;
    await pushOneBranch(repoPath, branch, force);
    this.pushed.push({ repoPath, branch, force });
  }
}
