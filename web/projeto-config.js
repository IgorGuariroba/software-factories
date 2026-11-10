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
/**
 * Provedores permitidos a partir do campo de texto: separados por vírgula, sem vazios nem repetidos (ticket 08).
 * @param {string} texto
 * @returns {string[]}
 */
export function provedoresDoFormulario(texto) {
  return [...new Set(deTexto(texto))];
}

/**
 * Configuração inteira a partir do formulário, sobre a atual (o que a página não edita fica como está).
 * @param {Record<string, any>} atual
 * @param {{ fonte: object, perfis: object[], pessoas: object[], dryRun: boolean, repositorios?: object[], telegram?: "full" | "minimal", provedores?: string[] }} campos
 * @returns {Record<string, any>}
 */
export function configDoFormulario(atual, opcoes) {
  const { fonte, perfis, pessoas, dryRun, repositorios, telegram, etapas, skills, mcpServers, provedores } = opcoes;
  const nova = { ...atual, source: fonte, profiles: perfis, people: pessoas, dryRun };
  if (repositorios !== undefined) nova.repositories = repositorios;
  if (provedores !== undefined) nova.allowedProviders = provedores;
  // Nível de conteúdo no Telegram (fatia 09): o bloco guarda o que a página não edita, como outros campos dele.
  if (telegram !== undefined) nova.telegram = { ...(atual.telegram ?? {}), content: telegram };
  // Agentes das etapas: a chave presente com `undefined` remove o que estava gravado; ausente, mantém.
  if ("etapas" in opcoes) {
    if (etapas === undefined) delete nova.etapas;
    else nova.etapas = etapas;
  }
  // Skills do projeto (fatia 10): a mesma regra das etapas, lidas do editor de skills.
  if ("skills" in opcoes) {
    if (skills === undefined) delete nova.skills;
    else nova.skills = skills;
  }
  // Servidores MCP do projeto (fatia 09): mesma regra das skills.
  if ("mcpServers" in opcoes) {
    if (mcpServers === undefined) delete nova.mcpServers;
    else nova.mcpServers = mcpServers;
  }
  return nova;
}

const mesmasFerramentas = (a, b) => a.length === b.length && a.every((nome, i) => nome === b[i]);

/**
 * Lê o editor de skills do projeto. Linhas sem nome ou sem conteúdo são descartadas; o nome perde os espaços das pontas.
 * @param {{ nome: string, descricao?: string, conteudo: string }[]} linhas
 */
export function skillsDoFormulario(linhas) {
  return linhas
    .map((l) => ({ nome: l.nome.trim(), descricao: l.descricao?.trim() ?? "", conteudo: l.conteudo }))
    .filter((skill) => skill.nome !== "" && skill.conteudo.trim() !== "")
    .map((skill) => (skill.descricao ? skill : { nome: skill.nome, conteudo: skill.conteudo }));
}

/**
 * Lê o editor de servidores MCP do projeto. Os argumentos vêm um por linha, para que um argumento possa ter espaço.
 * Linhas sem nome ou sem comando são descartadas.
 * @param {{ nome: string, comando: string, argumentos: string }[]} linhas
 */
export function servidoresMcpDoFormulario(linhas) {
  return linhas
    .map((l) => ({
      nome: l.nome.trim(),
      comando: l.comando.trim(),
      argumentos: l.argumentos
        .split("\n")
        .map((a) => a.trim())
        .filter((a) => a !== ""),
    }))
    .filter((servidor) => servidor.nome !== "" && servidor.comando !== "");
}

/**
 * Converte o formulário de cada etapa no bloco `etapas` da configuração. Só grava o que foi preenchido ou mudou: uma
 * etapa intocada não ganha bloco, e assim continua usando o padrão embutido. Devolve `undefined` se nenhuma etapa muda.
 * @param {Record<string, { modelo: {provider: string, model: string} | null, promptAdicional: string, ferramentas: string[], padrao: string[], skills?: string[], mcp?: { servidor: string, ferramentas: string[] }[] }>} linhas
 */
export function etapasDoFormulario(linhas) {
  const saida = {};
  for (const [etapa, linha] of Object.entries(linhas)) {
    const bloco = {};
    const provedor = linha.modelo?.provider?.trim();
    const modelo = linha.modelo?.model?.trim();
    if (provedor && modelo) bloco.modelo = { provider: provedor, model: modelo };
    if (linha.promptAdicional?.trim()) bloco.promptAdicional = linha.promptAdicional;
    if (linha.ferramentas && !mesmasFerramentas(linha.ferramentas, linha.padrao ?? []))
      bloco.ferramentas = linha.ferramentas;
    if (linha.skills?.length) bloco.skills = linha.skills;
    if (linha.mcp?.length) bloco.mcp = linha.mcp;
    if (Object.keys(bloco).length > 0) saida[etapa] = bloco;
  }
  return Object.keys(saida).length > 0 ? saida : undefined;
}

/**
 * Texto e ações da seção Estado conforme o estado do projeto (ticket 09). Só ativo pausa; só pausado retoma. Pura, para
 * ser testada em Node.
 * @param {"incompleto" | "ativo" | "pausado"} estado
 * @returns {{ texto: string, pausar: boolean, retomar: boolean }}
 */
export function acoesDoEstado(estado) {
  if (estado === "ativo") return { texto: "Ativo: a fábrica executa este projeto.", pausar: true, retomar: false };
  if (estado === "pausado")
    return {
      texto: "Pausado: a fábrica não executa este projeto até você retomá-lo. A configuração foi preservada.",
      pausar: false,
      retomar: true,
    };
  return {
    texto: "Incompleto: a fábrica não executa este projeto até completar o que falta.",
    pausar: false,
    retomar: false,
  };
}

/**
 * Estado da configuração de projeto em modo leitura (fatia 02): o formulário fica travado até "Editar". Pura, para
 * ser testada em Node; a tela só aplica o resultado.
 * @param {boolean} editando
 * @returns {{ formularioTravado: boolean, editarVisivel: boolean, cancelarVisivel: boolean }}
 */
export function estadoDoFormulario(editando) {
  return { formularioTravado: !editando, editarVisivel: !editando, cancelarVisivel: editando };
}

/**
 * Uma linha por alteração do histórico: quando, e quais campos mudaram (sem valores).
 * @param {{ quando: string, autor?: string, campos: string[] }[]} alteracoes
 */
export function resumoHistorico(alteracoes) {
  const quem = (autor) => (autor === "usuario" ? "usuário" : autor);
  return alteracoes.map(
    (a) => `${new Date(a.quando).toLocaleString("pt-BR")} (${quem(a.autor)}): ${a.campos.join(", ")}`,
  );
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

/**
 * Opções do seletor de credencial (ticket 03): "sem credencial" e os nomes cadastrados no cofre. Um nome salvo que não
 * está mais no cofre continua na lista, marcado, para não sumir do formulário ao salvar.
 * @param {{ nome: string }[]} credenciais
 * @param {string} [atual]
 * @returns {{ valor: string, texto: string }[]}
 */
export function opcoesDeCredenciais(credenciais, atual = "") {
  const nomes = credenciais.map((c) => c.nome);
  const naoCadastrada = atual !== "" && !nomes.includes(atual);
  return [
    { valor: "", texto: "sem credencial" },
    ...nomes.map((nome) => ({ valor: nome, texto: nome })),
    ...(naoCadastrada ? [{ valor: atual, texto: `${atual} (não cadastrada)` }] : []),
  ];
}

/**
 * Linha da lista do cofre: nome e data da última gravação. O valor nunca entra aqui, porque a API não o devolve.
 * @param {{ nome: string, atualizadoEm: string }} credencial
 */
export function linhaDaCredencial(credencial) {
  const data = new Date(credencial.atualizadoEm);
  const quando = Number.isNaN(data.getTime()) ? "" : ` · atualizada em ${data.toLocaleString("pt-BR")}`;
  return `${credencial.nome}${quando}`;
}
