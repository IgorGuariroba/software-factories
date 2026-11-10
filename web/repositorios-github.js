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
    const nada = r.criadas + r.vinculadas + r.atualizadas + r.ignoradas === 0;
    if (nada) return `${ultima} Nenhuma issue aberta neste repositório.`.trim();
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

/**
 * Comando de teste digitado (ex.: `npm test`) como lista de argumentos, sem vazios. O servidor exige ao menos um.
 * @param {string} texto
 */
export const comandoDoTexto = (texto) =>
  String(texto ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/**
 * Campos do schema da Fonte que o formulário de criação mostra. No GitHub Issues, o repositório é o do catálogo, então
 * o campo não aparece.
 * @param {string} tipo
 * @param {{ campo: string }[]} campos
 */
export const camposDaFonteNaCriacao = (tipo, campos) =>
  campos.filter((c) => !(tipo === "github" && c.campo === "repo"));

/**
 * Corpo de `POST /projetos/gitlab` a partir dos campos do formulário (ticket 04). O servidor vazio quer dizer gitlab.com;
 * a Fonte é GitLab Issues, com o prefixo e o usuário dono das issues. O servidor confere o caminho com o token.
 * @param {{ nome: string, servidor: string, caminho: string, credencial: string, prefixo: string, dono: string, comandoTeste: string, horario: string, ensaio: boolean, pessoas?: { po?: string, techLead?: string } }} campos
 */
export const corpoProjetoGitlab = (campos) => ({
  nome: campos.nome.trim(),
  caminho: campos.caminho.trim(),
  servidor: campos.servidor.trim(),
  fonte: { project: campos.prefixo.trim(), assignee: campos.dono.trim(), credential: campos.credencial },
  comandoTeste: comandoDoTexto(campos.comandoTeste),
  horario: campos.horario,
  ensaio: campos.ensaio,
  ...(campos.pessoas ? { pessoas: campos.pessoas } : {}),
});

/**
 * Opções de um seletor de PO ou tech lead (ticket 06): a primeira é "sem pessoa por enquanto", que deixa o projeto
 * incompleto; as demais são as pessoas da lista da Fonte.
 * @param {{ id: string, nome: string }[]} pessoas
 */
export function opcoesDePessoas(pessoas) {
  return [
    { valor: "", texto: "sem pessoa por enquanto (pendência)" },
    ...pessoas.map((p) => ({ valor: p.id, texto: p.nome && p.nome !== p.id ? `${p.nome} (${p.id})` : p.id })),
  ];
}

/**
 * Escolhas de PO e tech lead do formulário. Campo vazio não entra no corpo, e a criação não consulta a Fonte por isso.
 * @param {string} po
 * @param {string} techLead
 * @returns {{ po?: string, techLead?: string }}
 */
export function pessoasDoFormulario(po, techLead) {
  const escolhas = {};
  if (po) escolhas.po = po;
  if (techLead) escolhas.techLead = techLead;
  return escolhas;
}

/**
 * Texto de conclusão da criação: o que foi criado, em que modo e horário, e, se incompleto, o que falta.
 * @param {{ projeto: string, repo: string, ensaio: boolean, horario: string, estado: string, pendencias: string[] }} criado
 */
export function mensagemCriacao(criado) {
  const modo = criado.ensaio ? "em ensaio" : "execução real";
  const horario = criado.horario === "always" ? "sempre ativo" : "horário comercial";
  const situacao = criado.estado === "ativo" ? "Ativo." : `Incompleto: falta ${criado.pendencias.join("; ")}.`;
  return `Projeto ${criado.projeto} criado para ${criado.repo}, ${modo}, ${horario}. ${situacao}`;
}

/** Data e hora legíveis em português, a partir do ISO 8601. */
function formatarInstante(iso) {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? iso : data.toLocaleString("pt-BR");
}
