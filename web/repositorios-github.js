// Apresentação pura da tela de importação de repositórios do GitHub App: sem DOM, para testar em Node
// (test/web-repositorios-github.test.ts).

/**
 * Filtra o catálogo pelo texto digitado, sem diferenciar caixa, no nome `dono/nome` e no dono.
 * @param {{ nome: string, dono: string }[]} repos
 * @param {string} termo
 */
export function filtrarCatalogo(repos, termo) {
  const busca = termo.trim().toLowerCase();
  if (!busca) return repos;
  return repos.filter((r) => r.nome.toLowerCase().includes(busca) || r.dono.toLowerCase().includes(busca));
}

/**
 * Nome e prefixo sugeridos para o formulário de projeto. Espelha `sugerirProjeto` de src/projetos-github.ts: um teste
 * (test/web-repositorios-github.test.ts) garante que os dois continuam iguais.
 * @param {string} repo `dono/nome`
 */
export function sugerirProjeto(repo) {
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

/** Público ou privado, como o GitHub mostra. */
export const visibilidade = (repo) => (repo.privado ? "Privado" : "Público");

/**
 * Estado da importação de um repositório, com o que o botão faz. `tom` segue o das outras telas: "ok", "atencao" ou
 * "neutro".
 * @param {{ plugado: { projeto: string, status: string } | null, importacao: { status: string } | null }} repo
 */
export function estadoImportacao(repo) {
  if (repo.plugado === null) {
    return {
      rotulo: "Sem projeto",
      tom: "atencao",
      podeImportar: false,
      criarProjeto: true,
      rotuloBotao: "Criar projeto",
      ajuda: "Crie um projeto para este repositório para poder importar as issues.",
    };
  }
  if (repo.plugado.status === "desativado") {
    return {
      rotulo: "Desplugado",
      tom: "neutro",
      podeImportar: false,
      ajuda: "Plugue o repositório em Configurações para importar.",
    };
  }
  const status = repo.importacao?.status;
  if (status === "importando") return { rotulo: "Importando…", tom: "neutro", podeImportar: false, rotuloBotao: "" };
  if (status === "erro") {
    return { rotulo: "Falhou", tom: "atencao", podeImportar: true, rotuloBotao: "Tentar de novo" };
  }
  if (status === "ok") return { rotulo: "Importado", tom: "ok", podeImportar: true, rotuloBotao: "Importar de novo" };
  return { rotulo: "Não importado", tom: "neutro", podeImportar: true, rotuloBotao: "Importar issues" };
}

/**
 * Linha de situação da importação: quando foi a última, o que ela fez e, se falhou, a mensagem do erro.
 * @param {{ status: string, ultimaImportacaoEm?: string, ultimoErro?: string, ultimoResultado?: object } | null} importacao
 */
export function textoImportacao(importacao) {
  if (!importacao) return "Nunca importado.";
  const ultima = importacao.ultimaImportacaoEm
    ? `Última importação: ${formatarInstante(importacao.ultimaImportacaoEm)}.`
    : "";
  if (importacao.status === "importando") return `Importando as issues abertas… ${ultima}`.trim();
  if (importacao.status === "erro") {
    return `Falhou: ${importacao.ultimoErro ?? "erro desconhecido"}. ${ultima}`.trim();
  }
  if (importacao.status === "ok" && importacao.ultimoResultado) {
    const r = importacao.ultimoResultado;
    return `${ultima} ${r.criadas} criadas · ${r.vinculadas} vinculadas · ${r.atualizadas} atualizadas · ${r.ignoradas} ignoradas.`.trim();
  }
  return ultima || "Nunca importado.";
}

/**
 * Mensagem do catálogo quando o App não responde como deveria; vazia quando há repositórios para mostrar.
 * @param {{ configurado: boolean, erro?: string }} catalogo
 */
export function mensagemCatalogo(catalogo) {
  if (!catalogo.configurado) {
    return "GitHub App não configurado: defina FACTORY_GITHUB_APP_ID e FACTORY_GITHUB_APP_PRIVATE_KEY_PATH e reinicie o daemon.";
  }
  if (catalogo.erro) return `Não foi possível consultar o GitHub App: ${catalogo.erro}`;
  return "";
}

/** Há importação em andamento? A tela consulta de novo enquanto houver. */
export const temImportacaoEmAndamento = (repos) => repos.some((r) => r.importacao?.status === "importando");

/** Data e hora legíveis em português, a partir do ISO 8601. */
function formatarInstante(iso) {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? iso : data.toLocaleString("pt-BR");
}
