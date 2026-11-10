import { ProjectConfig } from "./config.js";

/**
 * Projetos de repositório GitHub criados pela página Repositórios (ADR-0016, Fase 6). Função pura: o daemon confere
 * o App e grava o resultado no estado. Modelos, estados e o PO vêm do primeiro projeto do YAML, que serve de referência;
 * a interface não escolhe modelo nesta fase.
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

/**
 * Configuração de um projeto de repositório GitHub. Ensaio (`dryRun`) é o padrão: a fábrica só registra as escritas até
 * o usuário desligá-lo. Lança erro com a mensagem em português se o nome, o prefixo ou o repositório forem inválidos.
 */
export function montarProjetoGithub(opts: {
  padroes: PadroesProjeto;
  repo: string;
  nome: string;
  prefixo: string;
  ensaio: boolean;
}): ProjectConfig {
  if (!NOME_PROJETO.test(opts.nome)) {
    throw new Error("nome: use minúsculas, números e hífen, começando por letra (2 a 40 caracteres)");
  }
  if (!PREFIXO_CARD.test(opts.prefixo)) {
    throw new Error("prefixo: use de 2 a 10 letras maiúsculas ou números, começando por letra");
  }
  const dono = opts.repo.split("/")[0] ?? "";
  const parsed = ProjectConfig.safeParse({
    name: opts.nome,
    activity: "always",
    dryRun: opts.ensaio,
    source: {
      type: "github",
      project: opts.prefixo,
      repo: opts.repo,
      assignee: dono,
      triageApproval: true,
      maxActive: 1,
      ignoreLabels: ["epic"],
    },
    statuses: opts.padroes.statuses,
    roles: opts.padroes.roles,
    people: [{ id: dono, role: "po" }],
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

/**
 * Conflito com o que já existe: o mesmo nome, o mesmo prefixo (sem diferenciar caixa, pois as chaves dos cards colidiriam)
 * ou o mesmo repositório já monitorado por outro projeto.
 */
export function conflitoProjeto(
  novo: { nome: string; prefixo: string; repo: string },
  existentes: ProjectConfig[],
): string | undefined {
  for (const p of existentes) {
    if (p.name === novo.nome) return `já existe um projeto chamado ${novo.nome}`;
    if (p.source.type === "github") {
      if (p.source.project.toUpperCase() === novo.prefixo.toUpperCase()) {
        return `o prefixo ${p.source.project} já é usado pelo projeto ${p.name}`;
      }
      if (p.source.repo.toLowerCase() === novo.repo.toLowerCase()) {
        return `${novo.repo} já é monitorado pelo projeto ${p.name}`;
      }
    }
  }
  return undefined;
}
