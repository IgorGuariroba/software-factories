import { hostDoServidor } from "../../../gitlab-repositorio.js";
import {
  listarPessoasGitlab,
  listarPessoasJira,
  type PessoaDaFonte,
  pessoasDeAssignees,
} from "../../../pessoas-fonte.js";
import { repoDoCatalogo } from "./catalogo.js";
import type { PortasProjetos, Resposta } from "./portas.js";

/** Lista de pessoas do GitLab do projeto, com o token do cofre. Falha de rede ou de resposta lança o erro. */
export async function listarPessoasGitlabDoModulo(
  portas: Pick<PortasProjetos, "segredos" | "fetchGitlab">,
  host: string,
  caminho: string,
  credencial: string,
): Promise<PessoaDaFonte[]> {
  return listarPessoasGitlab({
    host,
    caminho,
    token: (await portas.segredos.get(credencial)) ?? "",
    fetch: portas.fetchGitlab ?? fetch,
  });
}

/** Lista de pessoas do Jira (usuários atribuíveis ao projeto), com o token do cofre. */
export async function listarPessoasJiraDoModulo(
  portas: Pick<PortasProjetos, "segredos" | "fetchFonte">,
  baseUrl: string,
  email: string,
  credencial: string,
  projeto: string,
): Promise<PessoaDaFonte[]> {
  return listarPessoasJira({
    baseUrl,
    email,
    token: (await portas.segredos.get(credencial)) ?? "",
    projeto,
    fetch: portas.fetchFonte ?? fetch,
  });
}

/** Corpo de `pessoasParaCriacao`: diz de qual Fonte se trata e os campos dela. Qualquer outra coisa é recusada. */
export async function pessoasParaCriacao(
  portas: Pick<PortasProjetos, "segredos" | "fetchGitlab" | "fetchFonte" | "github">,
  bruto: unknown,
): Promise<Resposta> {
  const corpo = (bruto ?? {}) as Record<string, unknown>;
  const texto = (valor: unknown) => (typeof valor === "string" ? valor.trim() : "");
  try {
    if (corpo.tipo === "gitlab") {
      const credencial = texto(corpo.credencial);
      if (credencial === "" || !(await portas.segredos.has(credencial)))
        return { status: 400, body: { error: "informe a credencial do token do GitLab, cadastrada no cofre" } };
      let host: string;
      try {
        host = hostDoServidor(texto(corpo.servidor));
      } catch (err) {
        return { status: 400, body: { error: err instanceof Error ? err.message : "servidor inválido" } };
      }
      const lista = await listarPessoasGitlabDoModulo(portas, host, texto(corpo.caminho), credencial);
      return { status: 200, body: lista };
    }
    if (corpo.tipo === "jira") {
      const credencial = texto(corpo.credencial);
      if (credencial === "" || !(await portas.segredos.has(credencial)) || !texto(corpo.baseUrl) || !texto(corpo.email))
        return { status: 400, body: { error: "a Fonte Jira precisa de credencial do cofre, baseUrl e email" } };
      const lista = await listarPessoasJiraDoModulo(
        portas,
        texto(corpo.baseUrl),
        texto(corpo.email),
        credencial,
        texto(corpo.projeto),
      );
      return { status: 200, body: lista };
    }
    if (corpo.tipo === "github") {
      if (!Number.isInteger(corpo.repoId)) return { status: 400, body: { error: "informe repoId do repositório" } };
      const encontrado = await repoDoCatalogo(portas, corpo.repoId as number);
      if ("erro" in encontrado) return encontrado.erro;
      const { repo } = encontrado;
      const lista = pessoasDeAssignees(await portas.github.responsaveisPossiveis(repo.nome, repo.instalacaoId));
      return { status: 200, body: lista };
    }
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "falha ao consultar a Fonte";
    return { status: 502, body: { error: motivo } };
  }
  return { status: 400, body: { error: "tipo: use gitlab, github ou jira" } };
}
