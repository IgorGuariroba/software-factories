import { ProjectConfig } from "./config.js";

/**
 * Projetos criados pela página Repositórios (ADR-0016, ADR-0022). Funções puras: o daemon confere o App, clona o
 * repositório e grava o resultado no estado. Modelos, estados e o formato de cada item vêm do primeiro projeto do
 * YAML, que serve de referência; a interface não escolhe modelo nesta fase.
 */

/** Nome do projeto: minúsculas, números e hífen, começando por letra (também é o nome do diretório de conhecimento). */
export const NOME_PROJETO = /^[a-z][a-z0-9-]{1,39}$/;
/** Prefixo das chaves dos cards (`PREFIXO-123`): maiúsculas e números, começando por letra. */
export const PREFIXO_CARD = /^[A-Z][A-Z0-9]{1,9}$/;

/** O que o projeto novo herda do projeto de referência do YAML. */
export interface PadroesProjeto {
  roles: ProjectConfig["roles"];
  statuses: ProjectConfig["statuses"];
}

export const padroesDe = (referencia: ProjectConfig): PadroesProjeto => ({
  roles: referencia.roles,
  statuses: referencia.statuses,
});

/** Nome e prefixo sugeridos a partir de `dono/nome`: o nome do repositório e as iniciais das palavras. */
export function sugerirProjeto(repo: string): { nome: string; prefixo: string } {
  const base = (repo.split("/")[1] ?? repo).toLowerCase();
  let nome = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(nome)) nome = `p-${nome}`;
  nome = nome.slice(0, 40).replace(/-+$/, "");
  if (nome.length < 2) nome = `${nome}-projeto`;
  const palavras = base.split(/[^a-z0-9]+/).filter(Boolean);
  let prefixo = palavras
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 4);
  if (prefixo.length < 2) prefixo = `${base.replace(/[^a-z0-9]/g, "")}XX`.slice(0, 2).toUpperCase();
  if (!/^[A-Z]/.test(prefixo)) prefixo = `P${prefixo}`.slice(0, 4);
  return { nome, prefixo };
}

/** Fontes de issues: a mesma Fonte de issues no mesmo repositório não pode ter dois projetos (ADR-0022). */
const FONTES_DE_ISSUES: readonly string[] = ["github", "gitlab"];

/**
 * Configuração de um projeto novo criado pela interface, com um repositório do GitHub App clonado pela fábrica em
 * `caminho` (diretório gerenciado; o usuário não informa caminho). A Fonte é a escolhida no formulário, sem valor
 * fixo; no GitHub, o repositório dela é o do App. O projeto nasce sem pessoas: PO e tech lead são pendências até o
 * usuário informá-los. Lança erro com a mensagem em português se algum campo for inválido.
 */
export function montarProjetoGithub(opts: {
  padroes: PadroesProjeto;
  /** `dono/nome` do repositório escolhido no catálogo do App. */
  repo: string;
  /** Diretório do clone gerenciado pela fábrica. */
  caminho: string;
  nome: string;
  /** Fonte escolhida, com `type` e os campos do schema dela; `project` é o prefixo das chaves dos cards. */
  fonte: Record<string, unknown>;
  horario: "always" | "business-hours";
  /** Ensaio (`dryRun`): a fábrica só registra as escritas até o usuário desligá-lo. */
  ensaio: boolean;
  /** Comando de teste do repositório, em argv (sem shell). */
  comandoTeste: string[];
}): ProjectConfig {
  if (!NOME_PROJETO.test(opts.nome)) {
    throw new Error("nome: use minúsculas, números e hífen, começando por letra (2 a 40 caracteres)");
  }
  const prefixo = String(opts.fonte.project ?? "")
    .trim()
    .toUpperCase();
  if (!PREFIXO_CARD.test(prefixo)) {
    throw new Error("prefixo: use de 2 a 10 letras maiúsculas ou números, começando por letra");
  }
  const tipo = opts.fonte.type;
  if (tipo !== "github" && tipo !== "gitlab" && tipo !== "jira") throw new Error("fonte: escolha a Fonte do projeto");
  const dono = opts.repo.split("/")[0] ?? "";
  const fonte =
    tipo === "github"
      ? { ...opts.fonte, project: prefixo, repo: opts.repo, assignee: opts.fonte.assignee ?? dono }
      : { ...opts.fonte, project: prefixo };
  const parsed = ProjectConfig.safeParse({
    name: opts.nome,
    activity: opts.horario,
    dryRun: opts.ensaio,
    source: fonte,
    statuses: opts.padroes.statuses,
    roles: opts.padroes.roles,
    people: [],
    repositories: [{ path: opts.caminho, prefix: prefixo, test: { command: opts.comandoTeste } }],
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

/**
 * Conflito com o que já existe: o mesmo nome, o mesmo prefixo (sem diferenciar caixa, pois as chaves dos cards
 * colidiriam), ou a mesma Fonte de issues (GitHub ou GitLab) no mesmo repositório. Um repositório usado por Fontes
 * diferentes, como Jira e GitHub Issues, é permitido.
 */
export function conflitoProjeto(
  novo: { nome: string; prefixo: string; fonteTipo: string; fonteRepo?: string },
  existentes: ProjectConfig[],
): string | undefined {
  for (const p of existentes) {
    if (p.name === novo.nome) return `já existe um projeto chamado ${novo.nome}`;
    if (p.source.project.toUpperCase() === novo.prefixo.toUpperCase()) {
      return `o prefixo ${p.source.project} já é usado pelo projeto ${p.name}`;
    }
    if (
      novo.fonteRepo &&
      FONTES_DE_ISSUES.includes(novo.fonteTipo) &&
      p.source.type === novo.fonteTipo &&
      "repo" in p.source &&
      p.source.repo.toLowerCase() === novo.fonteRepo.toLowerCase()
    ) {
      return `${novo.fonteRepo} já tem a Fonte ${novo.fonteTipo} de issues no projeto ${p.name}`;
    }
  }
  return undefined;
}
