// Apresentação pura da página de configuração de projeto: sem DOM, para testar em Node (test/web-projetos-config.test.ts).
// A regra de negócio fica na API; aqui só se convertem valores de formulário em configuração e vice-versa.

const PAPEIS = ["po", "tech_lead", "outro"];

const emTexto = (valor) => (Array.isArray(valor) ? valor.join(", ") : (valor ?? ""));
/** Lista digitada separada por vírgula, sem vazios nem espaços. */
const deTexto = (texto) =>
  String(texto ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Campos do schema da Fonte, com o valor atual para o formulário.
 * @param {{ campo: string, rotulo: string, tipo: string, obrigatorio: boolean }[]} esquema
 * @param {Record<string, unknown>} atual
 */
export function camposDaFonte(esquema, atual) {
  return esquema.map((c) => ({ ...c, valor: emTexto(atual?.[c.campo]) }));
}

/**
 * Objeto `source` a partir dos valores do formulário. Listas viram arrays; campo vazio opcional é omitido.
 * @param {string} tipo
 * @param {{ campo: string, tipo: string, obrigatorio: boolean }[]} esquema
 * @param {Record<string, string>} valores
 */
export function fonteDoFormulario(tipo, esquema, valores) {
  const fonte = { type: tipo };
  for (const c of esquema) {
    const bruto = valores[c.campo];
    if (c.tipo === "lista") {
      const itens = deTexto(bruto);
      if (itens.length > 0) fonte[c.campo] = itens;
      continue;
    }
    const texto = String(bruto ?? "").trim();
    if (texto !== "") fonte[c.campo] = texto;
  }
  return fonte;
}

/** Perfis do formulário: sem nome, descarta; papel fora da lista vira `outro`. */
export function perfisDoFormulario(linhas) {
  return linhas
    .map((l) => ({ nome: String(l.nome ?? "").trim(), papel: PAPEIS.includes(l.papel) ? l.papel : "outro" }))
    .filter((p) => p.nome !== "");
}

const IDENTIDADES = ["teams", "jira", "github", "gitlab"];

/** Pessoas do formulário: exige identificador; guarda identidades preenchidas, canal escolhido e o papel da forma antiga. */
export function pessoasDoFormulario(linhas) {
  return linhas
    .filter((l) => String(l.id ?? "").trim() !== "")
    .map((l) => {
      const identidades = {};
      for (const nome of IDENTIDADES) {
        const valor = String(l[nome] ?? "").trim();
        if (valor !== "") identidades[nome] = valor;
      }
      const pessoa = { id: String(l.id).trim(), perfis: deTexto(l.perfis), identidades };
      // Canal escolhido (fatia 08); vazio = automático, que não entra na configuração.
      if (l.canal === "card-comment" || l.canal === "teams") pessoa.canal = l.canal;
      // Forma antiga: quem tem `role` e nenhum perfil mantém o papel, para não sumir do roteamento ao salvar.
      if (pessoa.perfis.length === 0 && (l.role === "po" || l.role === "tech_lead")) return { ...pessoa, role: l.role };
      return pessoa;
    });
}

/**
 * Configuração inteira para salvar: o que a página edita substitui o atual, o resto fica como estava.
 */
/**
 * @param {Record<string, unknown>} atual
 * @param {{ fonte: object, perfis: object[], pessoas: object[], dryRun: boolean, repositorios?: object[] }} opcoes
 */
export function configDoFormulario(atual, { fonte, perfis, pessoas, dryRun, repositorios }) {
  const nova = { ...atual, source: fonte, profiles: perfis, people: pessoas, dryRun };
  if (repositorios !== undefined) nova.repositories = repositorios;
  return nova;
}

/**
 * Uma linha por alteração do histórico: quando, e quais campos mudaram (sem valores).
 * @param {{ quando: string, autor?: string, campos: string[] }[]} alteracoes
 */
export function resumoHistorico(alteracoes) {
  return alteracoes.map((a) => `${new Date(a.quando).toLocaleString("pt-BR")}: ${a.campos.join(", ")}`);
}

/**
 * Repositórios do formulário (fatia 10). O comando de teste é digitado com espaços e vira lista de argumentos, sem shell.
 * Linhas sem caminho são descartadas; campos que a tela não edita (ex.: `format`, `timeoutSeconds`) vêm do original.
 * @param {(Record<string, unknown> & { path: string, prefix?: string, test?: Record<string, unknown> })[]} original
 * @param {{ path: string, prefix: string, comando: string }[]} linhas
 */
export function repositoriosDoFormulario(original, linhas) {
  return linhas
    .filter((l) => String(l.path ?? "").trim() !== "")
    .map((l) => {
      const path = String(l.path).trim();
      const anterior = original.find((r) => r.path === path) ?? {};
      const command = String(l.comando ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      return { ...anterior, path, prefix: String(l.prefix ?? "").trim(), test: { ...(anterior.test ?? {}), command } };
    });
}
