import type { ChangeRequest, CodeHost, RequestDraft } from "./code-host.js";
import type { Escrita } from "./escrita-efeitos.js";
import { redactSecrets } from "./secrets.js";

// Efeitos de código da fábrica (push da branch e PR/MR): as regras de branch protegida e de revisão ficam aqui; o motor de
// escrita (guardrails e dry-run) e a checagem de card são de quem chama.

/** Branches que a fábrica nunca empurra nem sobrescreve (push e force-push). */
export const PROTECTED_BRANCHES: ReadonlySet<string> = new Set(["main", "master", "develop"]);

/** Os efeitos de código, com as mesmas assinaturas que o escritor de efeitos publica. */
export interface EfeitosDeCodigo {
  pushBranch(repoPath: string, branch: string, opts?: { force?: boolean }): Promise<void>;
  ensureRequest(cardKey: string, repoPath: string, draft: RequestDraft): Promise<ChangeRequest | undefined>;
}

/** O motor de escrita e as checagens que os efeitos de código usam. */
export interface DepsEfeitosDeCodigo {
  codeHost?: CodeHost;
  isFactoryBranch?: (branch: string) => boolean | Promise<boolean>;
  isReviewedBranch?: (cardKey: string, repoPath: string, draft: RequestDraft) => Promise<boolean>;
  write: <T>(
    w: Escrita,
    check: () => Promise<string | undefined>,
    run: () => Promise<T>,
    dry: () => T,
    once?: boolean,
  ) => Promise<T>;
  cardNotOwned(key: string): Promise<string | undefined>;
  outgoing(body: string): string;
}

export function criarEfeitosDeCodigo(opts: DepsEfeitosDeCodigo): EfeitosDeCodigo {
  const { write, cardNotOwned, outgoing } = opts;
  return {
    pushBranch(repoPath, branch, pushOpts) {
      const force = pushOpts?.force ?? false;
      const name = branch.replace(/^refs\/heads\//, "");
      return write(
        { target: name, action: force ? "force-push" : "push", content: `${repoPath} -> origin/${name}` },
        async () => {
          if (PROTECTED_BRANCHES.has(name)) return `push na branch protegida "${name}" é proibido`;
          if (force && !(await opts.isFactoryBranch?.(name)))
            return `force-push só nas branches da fábrica; "${name}" não é uma delas`;
          if (!opts.codeHost) return "projeto sem CodeHost configurado";
          return undefined;
        },
        () => (opts.codeHost as CodeHost).pushBranch(repoPath, name, { force }),
        () => undefined,
      );
    },

    async ensureRequest(cardKey, repoPath, draft) {
      const safe = { ...draft, title: redactSecrets(draft.title), body: outgoing(draft.body) };
      return write<ChangeRequest | undefined>(
        { target: cardKey, action: "pull-request", content: JSON.stringify(safe) },
        async () => {
          const notOwned = await cardNotOwned(cardKey);
          if (notOwned) return notOwned;
          if (PROTECTED_BRANCHES.has(draft.branch)) return "PR/MR não pode sair de branch protegida";
          if (!opts.codeHost || !(await opts.isReviewedBranch?.(cardKey, repoPath, draft)))
            return "a publicação exige branch da Tarefa com review aprovado do HEAD atual";
          return undefined;
        },
        () => (opts.codeHost as CodeHost).ensureRequest(repoPath, safe),
        () => undefined,
      );
    },
  };
}
