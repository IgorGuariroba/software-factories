import type { CodeHost } from "./code-host.js";
import { discoverGitConventions } from "./conventions.js";
import { git } from "./git.js";

/** Push de uma única branch para a mesma branch em `origin`, com refspec explícito. */
export async function pushOneBranch(repoPath: string, branch: string, force: boolean): Promise<void> {
  const ref = `refs/heads/${branch}`;
  await git(repoPath, ["push", "--porcelain", ...(force ? ["--force-with-lease"] : []), "origin", `${ref}:${ref}`]);
}

/** Adaptador real do CodeHost na parte que é git: descoberta no histórico e push. O MR via `glab` vem depois. */
export const gitCodeHost: CodeHost = {
  discoverConventions: (repoPath) => discoverGitConventions(repoPath),
  pushBranch: (repoPath, branch, opts) => pushOneBranch(repoPath, branch, opts?.force ?? false),
};
