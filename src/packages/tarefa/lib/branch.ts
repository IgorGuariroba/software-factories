/** Rascunho de publicação que a branch precisa bater: a branch e a base de destino. */
export interface RascunhoBranch {
  branch: string;
  base: string;
}

/** Progresso da implementação que a branch da Tarefa registra. */
export interface ProgressoBranch {
  worktree: string;
  branch?: string;
  defaultBranch?: string | null;
  head?: string | null;
}

/**
 * Entradas da decisão. O que exige I/O (caminho real, branch padrão, HEAD) vem em thunks, chamados só quando a decisão
 * precisa deles: a ordem e a economia de chamadas ao git são as de antes.
 */
export interface EntradaBranch {
  cwd: string;
  rascunho: RascunhoBranch;
  progresso: ProgressoBranch | null | undefined;
  revisao: { status: string; head: string } | null | undefined;
  /** Aprovação da SPEC é exigida neste projeto? */
  exigeAprovacaoSpec: boolean;
  specRevisao: string | undefined;
  specAprovadaEmEnsaio: boolean | undefined;
  dryRun: boolean;
  caminhoReal(caminho: string): Promise<string | null>;
  branchPadrao(cwd: string): Promise<string>;
  headDoCwd(cwd: string): Promise<string>;
}

/**
 * A branch é a revisada e aprovada da Tarefa? Só conta se: o progresso tem a mesma worktree e a mesma branch do rascunho;
 * a revisão está aprovada; a SPEC foi aprovada no mesmo modo de ensaio (quando o projeto exige); a base do rascunho é a
 * branch padrão; e o HEAD local é o que a revisão aprovou.
 */
export async function branchRevisada(e: EntradaBranch): Promise<boolean> {
  const progresso = e.progresso;
  const revisao = e.revisao;
  if (
    !progresso ||
    (await e.caminhoReal(progresso.worktree)) !== e.cwd ||
    progresso.branch !== e.rascunho.branch ||
    revisao?.status !== "aprovado"
  )
    return false;
  if (e.exigeAprovacaoSpec && (e.specRevisao !== "approved" || e.specAprovadaEmEnsaio !== e.dryRun)) return false;
  const base = progresso.defaultBranch ?? (await e.branchPadrao(e.cwd));
  return e.rascunho.base === base && (await e.headDoCwd(e.cwd)) === revisao.head && revisao.head === progresso.head;
}
