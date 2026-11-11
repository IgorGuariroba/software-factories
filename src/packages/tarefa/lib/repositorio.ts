import type { RepoMapping } from "../../../config.js";
import type { Card } from "../../../demand-source.js";

/** Dependências da escolha do repositório da Tarefa. */
export interface PortasRepositorio {
  /** O card, como a Fonte o tem agora. Lança se ele não existe mais. */
  cartao(): Promise<Card>;
  /** Caminho escolhido pela pessoa (ou pela resposta a uma pergunta técnica); `undefined` se ainda não escolheu. */
  caminhoEscolhido(): Promise<string | undefined>;
  /** Repositórios configurados no projeto. */
  repositorios(): readonly RepoMapping[] | undefined;
  /** Repositório que o card identifica pelo prefixo ou pelo projeto, se houver um. */
  resolverPeloCard(card: Card): RepoMapping | undefined;
  /** Já há uma pergunta de repositório sem resposta? */
  perguntaPendente(): Promise<boolean>;
  /** Pergunta técnica pedindo o repositório, com a lista dos configurados. */
  perguntarRepositorio(card: Card, repositorios: readonly RepoMapping[]): Promise<void>;
}

/**
 * Escolhe o repositório em que a Tarefa será implementada. Com escolha explícita, vale a escolha; sem ela, vale o que o
 * card identifica. Se o projeto tem repositórios e nenhum serve, a Tarefa pergunta ao responsável técnico (uma vez só
 * enquanto a pergunta não tem resposta) e espera.
 */
export async function escolherRepositorio(
  portas: PortasRepositorio,
): Promise<{ caminho: string | undefined } | "aguardar"> {
  const card = await portas.cartao();
  const escolhido = await portas.caminhoEscolhido();
  const repositorios = portas.repositorios();
  const repositorio =
    escolhido !== undefined
      ? repositorios?.find((candidato) => candidato.path === escolhido)
      : portas.resolverPeloCard(card);
  if (repositorios?.length && !repositorio) {
    if (!(await portas.perguntaPendente())) await portas.perguntarRepositorio(card, repositorios);
    return "aguardar";
  }
  return { caminho: repositorio?.path };
}
