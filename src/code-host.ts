import type { RepoConventions } from "./conventions.js";

/**
 * Porta para o sistema que hospeda o código (GitLab via `glab` no M1). O git local roda de verdade; a porta cobre o que
 * depende do remoto. Só o escritor de efeitos chama `pushBranch`, depois dos guardrails.
 * Criar, atualizar e localizar MR entram aqui com as etapas de MR (M1-14/M1-15).
 */
export interface CodeHost {
  /** Convenções de branch e commit vistas no histórico do clone em `repoPath`. */
  discoverConventions(repoPath: string): Promise<RepoConventions>;
  /** Envia só `branch` do clone em `repoPath` para a mesma branch no remoto `origin`. */
  pushBranch(repoPath: string, branch: string, opts?: { force?: boolean }): Promise<void>;
}
