import type { RepoConventions } from "./conventions.js";

export interface ChangeRequest {
  number: number;
  url: string;
  head: string;
  state: "open" | "closed" | "merged";
  checks: "pending" | "passed" | "failed";
  conflicts: boolean;
  /** Comentários de discussão e achados de review, inclusive fora do diff. */
  feedback: { id: string; body: string; author: string }[];
}

export interface RequestDraft {
  branch: string;
  base: string;
  title: string;
  body: string;
}

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
  /** Localiza pela branch antes de criar: uma retomada nunca duplica PR/MR. Não existe operação de merge nesta porta. */
  ensureRequest(repoPath: string, draft: RequestDraft): Promise<ChangeRequest>;
  inspectRequest(repoPath: string, number: number): Promise<ChangeRequest>;
}
