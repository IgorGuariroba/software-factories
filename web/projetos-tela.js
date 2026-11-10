// Tela de configuração de projeto: monta o formulário a partir da API e grava pela API (ADR-0017). Não há regra de
// negócio aqui: a API valida tudo; esta tela só converte valores (ver projeto-config.js, testado em Node).
import { api, getSegredos } from "./api.js";
import { desenharEtapasAgente } from "./etapas-agente-tela.js";
import {
  acoesDoEstado,
  camposDaFonte,
  configDoFormulario,
  estadoDoFormulario,
  fonteDoFormulario,
  linhaDaCredencial,
  opcoesDeCredenciais,
  perfisDoFormulario,
  pessoasDoFormulario,
  provedoresDoFormulario,
  repositoriosDoFormulario,
  resumoHistorico,
} from "./projeto-config.js";

const IDENTIDADES = ["teams", "jira", "github", "gitlab"];

/** Cria um elemento com texto e filhos; nunca interpreta HTML vindo da API. */
function el(tag, props = {}, filhos = []) {
  const node = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props)) {
    if (chave === "texto") node.textContent = valor;
    else if (chave === "classe") node.className = valor;
    else if (chave === "valor") node.value = valor;
    else if (chave === "marcado") node.checked = valor;
    else if (chave.startsWith("on")) node.addEventListener(chave.slice(2), valor);
    else node.setAttribute(chave, valor);
  }
  for (const f of filhos) node.append(f);
  return node;
}

/** Rótulo visível acima do controle; o controle mantém o próprio aria-label. */
const rotulado = (texto, controle) => el("label", { class: "campo" }, [el("span", { texto }), controle]);

/** Cabeçalho de cartão: título e descrição com largura de leitura limitada. */
const cabecalhoCartao = (titulo, descricao) =>
  el("div", { class: "cartao-cabecalho" }, [el("h3", { texto: titulo }), el("p", { texto: descricao })]);

/**
 * Define o número de colunas via CSSOM: o CSP da página bloqueia `style` inline no HTML (style-src 'self'), mas aceita
 * `style.setProperty`.
 */
const comColunas = (node, quantidade) => {
  node.style.setProperty("--colunas", String(quantidade));
  return node;
};

/** Cabeçalho de colunas acima de uma lista de linhas repetidas (perfis, pessoas, repositórios). */
const cabecalhoGrade = (rotulos) =>
  comColunas(
    el(
      "div",
      { class: "grade-cabecalho", "aria-hidden": "true" },
      rotulos.map((r) => el("span", { texto: r })),
    ),
    rotulos.length,
  );

/** Linha de configuração (padrão de ajustes): título e descrição à esquerda, controle à direita. */
const linhaConfig = (titulo, descricao, controle) =>
  el("div", { class: "linha-config" }, [
    el("div", { class: "linha-config-texto" }, [
      el("span", { class: "linha-config-titulo", texto: titulo }),
      el("span", { class: "ajuda", texto: descricao }),
    ]),
    controle,
  ]);

/** Linha de controles alinhada às colunas do cabeçalho. */
const linhaGrade = (controles) => comColunas(el("div", { class: "grade-linha" }, controles), controles.length);

/**
 * Monta a tela dentro de `raiz`. Carrega a lista de projetos, o schema das Fontes e os modelos de perfis.
 * @param {HTMLElement} raiz
 */
export async function iniciarProjetos(raiz) {
  const [projetos, fontes, modelos, segredos] = await Promise.all([
    api("GET", "/projetos"),
    api("GET", "/integracoes/fontes"),
    api("GET", "/perfis/modelos"),
    getSegredos(),
  ]);
  const mensagem = el("p", { class: "mensagem", role: "status" });
  const seletor = el(
    "select",
    { id: "projeto-config-nome", "aria-label": "Projeto" },
    projetos.map((p) => el("option", { valor: p.nome, texto: p.nome })),
  );
  const corpo = el("div", { class: "projeto-config-corpo" });
  const cofreBox = el("section", { class: "bloco" });
  const telegramBox = el("section", { class: "bloco" });

  // Cofre único (ticket 03): credenciais por nome. Os seletores de Fonte e de Canal leem esta lista e são atualizados
  // quando ela muda; o valor nunca volta para a tela.
  let credenciais = segredos;
  const seletoresDeCredencial = new Set();
  const preencherSeletor = (sel, escolhido) => {
    sel.replaceChildren(
      ...opcoesDeCredenciais(credenciais, escolhido).map((o) => el("option", { valor: o.valor, texto: o.texto })),
    );
    sel.value = escolhido ?? "";
  };
  const seletorDeCredencial = (rotulo, atual = "") => {
    const sel = el("select", { "aria-label": rotulo });
    seletoresDeCredencial.add(sel);
    preencherSeletor(sel, atual);
    return sel;
  };
  const listaCredenciais = el("ul", { class: "lista-cofre" });
  const vazioCredenciais = el("div", { class: "estado-vazio-cartao" }, [
    el("p", { class: "estado-vazio-titulo", texto: "Nenhuma credencial cadastrada." }),
    el("p", { class: "ajuda", texto: "Cadastre a primeira abaixo para usá-la nas Fontes e nos Canais." }),
  ]);
  const desenharCofre = () => {
    listaCredenciais.replaceChildren(...credenciais.map((c) => el("li", { texto: linhaDaCredencial(c) })));
    listaCredenciais.hidden = credenciais.length === 0;
    vazioCredenciais.hidden = credenciais.length !== 0;
    for (const sel of [...seletoresDeCredencial]) {
      if (!sel.isConnected) seletoresDeCredencial.delete(sel);
      else preencherSeletor(sel, sel.value);
    }
  };
  const recarregarCredenciais = async () => {
    credenciais = await getSegredos();
    desenharCofre();
  };
  const nomeCredencial = el("input", { "aria-label": "Nome da credencial", placeholder: "ex.: jira-token" });
  const valorCredencial = el("input", { type: "password", "aria-label": "Valor da credencial", autocomplete: "off" });
  const gravarCredencial = el("button", { type: "button", class: "primario", texto: "Gravar credencial" });
  gravarCredencial.addEventListener("click", async () => {
    const nome = nomeCredencial.value.trim();
    try {
      await api("PUT", `/segredos/${encodeURIComponent(nome)}`, { valor: valorCredencial.value });
      valorCredencial.value = "";
      nomeCredencial.value = "";
      await recarregarCredenciais();
      mensagem.textContent = `Credencial ${nome} gravada. O valor não é exibido de novo; os projetos que a usam passam a usar o novo valor.`;
    } catch (erro) {
      mensagem.textContent = erro.message;
    }
  });
  cofreBox.replaceChildren(
    cabecalhoCartao(
      "Credenciais (cofre único)",
      "Cadastre a credencial com um nome e escolha-a pelo nome nas Fontes e nos Canais. Para trocar o valor, grave de novo com o mesmo nome.",
    ),
    listaCredenciais,
    vazioCredenciais,
    el("div", { class: "formulario-linha" }, [
      rotulado("Nome da credencial", nomeCredencial),
      rotulado("Valor", valorCredencial),
      el("div", { class: "acoes-cartao" }, [gravarCredencial]),
    ]),
  );
  desenharCofre();

  // Dois escopos separados: o que vale para o usuário inteiro, e o que é de cada projeto. O seletor de projeto fica
  // numa barra de contexto no topo do escopo "Por projeto", porque só ele muda o que aparece abaixo.
  // O projeto vem primeiro: é o foco da tela. Credenciais e Telegram são globais e ficam depois, como referência.
  raiz.replaceChildren(
    mensagem,
    el("section", { class: "escopo escopo-projeto", "aria-labelledby": "escopo-projeto-titulo" }, [
      el("div", {}, [
        el("h3", { class: "grupo-titulo", id: "escopo-projeto-titulo", texto: "Por projeto" }),
        el("p", {
          class: "grupo-descricao",
          texto: "Cada projeto tem a própria Fonte, pessoas, repositórios, provedores e agentes.",
        }),
      ]),
      el("div", { class: "projeto-contexto" }, [rotulado("Projeto", seletor)]),
      corpo,
    ]),
    el("section", { class: "escopo escopo-global", "aria-labelledby": "escopo-global-titulo" }, [
      el("div", {}, [
        el("h3", { class: "grupo-titulo", id: "escopo-global-titulo", texto: "Globais ao usuário" }),
        el("p", { class: "grupo-descricao", texto: "Valem para todos os projetos: cofre de credenciais e Telegram." }),
      ]),
      cofreBox,
      telegramBox,
    ]),
  );
  desenharTelegram(telegramBox, () => mensagem, seletorDeCredencial);

  async function carregar() {
    const nome = seletor.value;
    if (!nome) return;
    const [atual, situacao, historico, catalogo] = await Promise.all([
      api("GET", `/projetos/${encodeURIComponent(nome)}/configuracao`),
      api("GET", `/projetos/${encodeURIComponent(nome)}/estado`),
      api("GET", `/projetos/${encodeURIComponent(nome)}/historico`),
      api("GET", "/ferramentas"),
    ]);
    desenhar(nome, atual, situacao, historico, catalogo);
  }

  function desenhar(nome, atual, situacao, historico, catalogo) {
    const pendencias = situacao.pendencias;
    const tipoSel = el(
      "select",
      { "aria-label": "Tipo da Fonte" },
      fontes.map((f) => el("option", { valor: f.tipo, texto: f.rotulo })),
    );
    tipoSel.value = atual.source.type;
    const camposBox = el("div", { class: "projeto-config-campos" });
    const inputs = {};
    function desenharCampos() {
      const esquema = fontes.find((f) => f.tipo === tipoSel.value)?.campos ?? [];
      const valoresAtuais = tipoSel.value === atual.source.type ? atual.source : {};
      inputs.campos = {};
      camposBox.replaceChildren(
        ...camposDaFonte(esquema, valoresAtuais).map((c) => {
          // Credencial: escolhida pelo nome no cofre (ticket 03); o projeto guarda só o nome.
          const input =
            c.tipo === "segredo"
              ? seletorDeCredencial(c.rotulo, c.valor)
              : el("input", { id: `campo-${c.campo}`, valor: c.valor, "aria-label": c.rotulo });
          inputs.campos[c.campo] = { input, tipo: c.tipo, esquema: c };
          return el("label", { class: "campo" }, [el("span", { texto: c.rotulo }), input]);
        }),
      );
    }
    tipoSel.addEventListener("change", desenharCampos);
    desenharCampos();

    const perfisLinhas = [];
    const perfisBox = el("div");
    const pessoasLinhas = [];
    const pessoasBox = el("div");
    const addPerfil = (nome = "", papel = "outro") => {
      const n = el("input", { valor: nome, "aria-label": "Nome do perfil" });
      const p = el(
        "select",
        { "aria-label": "Papel do perfil" },
        ["po", "tech_lead", "outro"].map((v) => el("option", { valor: v, texto: v })),
      );
      p.value = papel;
      const linha = { nome: n, papel: p };
      perfisLinhas.push(linha);
      if (perfisBox.childElementCount === 0) perfisBox.append(cabecalhoGrade(["Nome do perfil", "Papel"]));
      perfisBox.append(linhaGrade([n, p]));
    };
    const addPessoa = (pessoa = { id: "", perfis: [], identidades: {} }) => {
      const campo = (rotulo, valor) => el("input", { valor, "aria-label": rotulo, placeholder: rotulo });
      const canal = el("select", { "aria-label": "Canal da pessoa" }, [
        el("option", { valor: "", texto: "padrão (comentário no card)" }),
        el("option", { valor: "card-comment", texto: "comentário no card" }),
        el("option", { valor: "teams", texto: "conversa no Teams (perguntas e respostas)" }),
      ]);
      canal.value = pessoa.canal ?? "";
      const linha = {
        role: pessoa.role,
        canal,
        id: campo("Identificador na Fonte", pessoa.id),
        perfis: campo("Perfis (vírgula)", (pessoa.perfis ?? []).join(", ")),
        ...Object.fromEntries(IDENTIDADES.map((k) => [k, campo(k, pessoa.identidades?.[k] ?? "")])),
      };
      pessoasLinhas.push(linha);
      const campos = Object.entries(linha)
        .filter(([chave]) => chave !== "role")
        .map(([, input]) => input);
      if (pessoasBox.childElementCount === 0)
        pessoasBox.append(cabecalhoGrade(["Canal", "Identificador na Fonte", "Perfis (vírgula)", ...IDENTIDADES]));
      pessoasBox.append(linhaGrade(campos));
    };
    for (const p of atual.profiles ?? []) addPerfil(p.nome, p.papel);
    for (const p of atual.people ?? []) addPessoa(p);
    // Repositórios locais (fatia 10): caminho, prefixo e comando de teste; os demais campos seguem como estão.
    const repoLinhas = [];
    const repoBox = el("div");
    const addRepo = (repo = { path: "", prefix: "", test: { command: [] } }) => {
      const linha = {
        path: el("input", { valor: repo.path, "aria-label": "Caminho do repositório local" }),
        prefix: el("input", { valor: repo.prefix ?? "", "aria-label": "Prefixo dos cards" }),
        comando: el("input", {
          valor: (repo.test?.command ?? []).join(" "),
          "aria-label": "Comando de teste (sem shell)",
        }),
      };
      repoLinhas.push(linha);
      if (repoBox.childElementCount === 0)
        repoBox.append(cabecalhoGrade(["Caminho do repositório local", "Prefixo dos cards", "Comando de teste"]));
      repoBox.append(linhaGrade([linha.path, linha.prefix, linha.comando]));
    };
    for (const r of atual.repositories ?? []) addRepo(r);
    const adicionarRepo = el("button", { type: "button", texto: "Adicionar repositório" });
    adicionarRepo.addEventListener("click", () => addRepo());

    const modelosBox = el(
      "div",
      { class: "modelos" },
      modelos.map((m) => {
        const b = el("button", { type: "button", texto: `Adicionar perfil ${m.nome}` });
        b.addEventListener("click", () => addPerfil(m.nome, m.papel));
        return b;
      }),
    );
    const adicionarPerfil = el("button", { type: "button", texto: "Adicionar perfil vazio" });
    adicionarPerfil.addEventListener("click", () => addPerfil());
    const adicionarPessoa = el("button", { type: "button", texto: "Adicionar pessoa" });
    adicionarPessoa.addEventListener("click", () => addPessoa());

    // Provedores de modelos permitidos ao projeto (ticket 08): sem nenhum, o projeto fica incompleto.
    const provedores = el("input", {
      valor: (atual.allowedProviders ?? []).join(", "),
      "aria-label": "Provedores permitidos (vírgula)",
    });

    const ensaio = el("input", { type: "checkbox", id: "projeto-config-ensaio", marcado: atual.dryRun === true });
    // Conteúdo das mensagens deste projeto no Telegram (fatia 09): completo ou mínimo.
    const conteudoTelegram = el("select", { "aria-label": "Conteúdo no Telegram" }, [
      el("option", { valor: "full", texto: "completo" }),
      el("option", { valor: "minimal", texto: "mínimo" }),
    ]);
    conteudoTelegram.value = atual.telegram?.content ?? "full";
    // Pausa e retomada (ticket 09): a configuração fica como está; o estado vem da API depois de cada ação.
    const acoes = acoesDoEstado(situacao.estado);
    const pausar = el("button", { type: "button", texto: "Pausar projeto" });
    const retomar = el("button", { type: "button", texto: "Retomar projeto" });
    pausar.hidden = !acoes.pausar;
    retomar.hidden = !acoes.retomar;
    // Troca de Fonte ou repositório (ticket 10): o projeto fica incompleto até o usuário confirmar a configuração nova.
    const confirmar = el("button", { type: "button", texto: "Confirmar nova Fonte ou repositório" });
    confirmar.hidden = situacao.aguardandoConfirmacao !== true;
    confirmar.addEventListener("click", async () => {
      try {
        const resposta = await api("POST", `/projetos/${encodeURIComponent(nome)}/confirmacao`);
        const fim = resposta.pendencias.length === 0 ? "" : `: ${resposta.pendencias.join("; ")}`;
        mensagem.textContent = `Nova Fonte ou repositório confirmado. Projeto ${resposta.estado}${fim}.`;
        await carregar();
      } catch (erro) {
        mensagem.textContent = erro.message;
      }
    });
    const aplicarPausa = async (chamar, sucesso) => {
      try {
        const resposta = await chamar();
        mensagem.textContent = resposta.estado === "pausado" ? sucesso.pausado : sucesso.ativo;
        await carregar();
      } catch (erro) {
        mensagem.textContent = erro.message;
      }
    };
    pausar.addEventListener("click", () =>
      aplicarPausa(() => api("POST", `/projetos/${encodeURIComponent(nome)}/pausa`), {
        pausado: "Projeto pausado. A configuração foi preservada.",
        ativo: "Projeto ativo.",
      }),
    );
    retomar.addEventListener("click", () =>
      aplicarPausa(() => api("POST", `/projetos/${encodeURIComponent(nome)}/retomada`), {
        pausado: "Projeto ainda pausado.",
        ativo: "Projeto retomado e ativo.",
      }),
    );
    const salvar = el("button", { type: "button", class: "primario", texto: "Salvar configuração" });
    salvar.addEventListener("click", async () => {
      try {
        const valores = Object.fromEntries(Object.entries(inputs.campos).map(([k, v]) => [k, v.input.value]));
        const fonte = fonteDoFormulario(
          tipoSel.value,
          fontes.find((f) => f.tipo === tipoSel.value)?.campos ?? [],
          valores,
        );
        const perfis = perfisDoFormulario(perfisLinhas.map((l) => ({ nome: l.nome.value, papel: l.papel.value })));
        const pessoas = pessoasDoFormulario(
          pessoasLinhas.map((l) => ({
            id: l.id.value,
            role: l.role,
            canal: l.canal.value,
            perfis: l.perfis.value,
            ...Object.fromEntries(IDENTIDADES.map((k) => [k, l[k].value])),
          })),
        );
        const repositorios = repositoriosDoFormulario(
          atual.repositories ?? [],
          repoLinhas.map((l) => ({ path: l.path.value, prefix: l.prefix.value, comando: l.comando.value })),
        );
        const nova = configDoFormulario(atual, {
          fonte,
          perfis,
          pessoas,
          dryRun: ensaio.checked,
          telegram: conteudoTelegram.value,
          provedores: provedoresDoFormulario(provedores.value),
          repositorios: atual.repositories || repositorios.length > 0 ? repositorios : undefined,
          etapas: lerEtapas(),
          skills: lerSkills(),
          mcpServers: lerServidores(),
        });
        await api("PUT", `/projetos/${encodeURIComponent(nome)}/configuracao`, nova);
        // Aviso visível: salvar pode deixar o projeto incompleto (ex.: removendo o último PO ou tech lead).
        const depois = await api("GET", `/projetos/${encodeURIComponent(nome)}/estado`);
        mensagem.textContent =
          depois.estado === "ativo"
            ? "Configuração salva. Projeto ativo."
            : `Configuração salva. Projeto incompleto, não executa: ${depois.pendencias.join("; ")}.`;
        await carregar();
      } catch (erro) {
        mensagem.textContent = erro.message;
      }
    });

    const etapasBox = el("section", { class: "bloco" });
    const { lerEtapas, lerSkills, lerServidores } = desenharEtapasAgente(etapasBox, atual, catalogo, el);

    // Seções na ordem da subnavegação. Cada uma tem âncora própria; a subnavegação rola até ela.
    const fonteSec = el("section", { class: "bloco" }, [
      el("h3", { texto: "Fonte de demandas" }),
      el("label", { class: "campo" }, [el("span", { texto: "Tipo" }), tipoSel]),
      camposBox,
    ]);
    const perfisSec = el("section", { class: "bloco" }, [
      el("h3", { texto: "Perfis" }),
      el("p", { class: "ajuda", texto: "Papéis que a fábrica consulta ao decidir a quem perguntar." }),
      modelosBox,
      adicionarPerfil,
      perfisBox,
    ]);
    const pessoasSec = el("section", { class: "bloco" }, [
      el("h3", { texto: "Pessoas do projeto" }),
      adicionarPessoa,
      pessoasBox,
    ]);
    const repositoriosSec = el("section", { class: "bloco" }, [
      el("h3", { texto: "Repositórios locais" }),
      adicionarRepo,
      repoBox,
    ]);
    const provedoresSec = el("section", { class: "bloco" }, [
      el("h3", { texto: "Provedores de modelos" }),
      el("label", { class: "campo" }, [el("span", { texto: "Provedores permitidos (vírgula)" }), provedores]),
    ]);
    // Ensaio e Telegram do projeto em linhas de configuração: rótulo e descrição à esquerda, controle à direita.
    const ensaioSec = el("section", { class: "bloco" }, [
      el("h3", { texto: "Ensaio e Telegram" }),
      linhaConfig(
        "Ensaio (dry-run)",
        "Registra as escritas sem aplicá-las. Use para testar a configuração antes de executar de verdade.",
        ensaio,
      ),
      linhaConfig(
        "Conteúdo no Telegram",
        "Completo traz o texto das mensagens; mínimo envia só o essencial.",
        conteudoTelegram,
      ),
    ]);
    const historicoSec = el("section", { class: "bloco" }, [
      el("h3", { texto: "Histórico de alterações" }),
      el(
        "ul",
        { class: "lista-simples" },
        historico.length === 0
          ? [el("li", { texto: "Sem alterações." })]
          : resumoHistorico(historico).map((linha) => el("li", { texto: linha })),
      ),
    ]);
    // Estado fica fora do formulário travado: pausar e retomar não são edições da configuração (ticket 09).
    const situacaoBox = el("section", { class: "bloco" }, [
      el("h3", { texto: "Estado" }),
      el("p", { texto: acoesDoEstado(situacao.estado).texto }),
      el("div", { class: "acoes-cartao" }, [pausar, retomar, confirmar]),
      el("h4", { class: "subtitulo", texto: "Pendências" }),
      el(
        "ul",
        { class: "lista-simples" },
        pendencias.length === 0
          ? [el("li", { texto: "Nenhuma pendência." })]
          : pendencias.map((p) => el("li", { texto: p })),
      ),
    ]);
    // Remoção (ticket 11): pede confirmação explícita; a fábrica recusa se houver Tarefa em andamento.
    const remocaoBox = el("section", { class: "bloco zona-perigo" }, [
      el("h3", { texto: "Remover projeto" }),
      el("p", {
        texto: `Apaga a configuração do projeto. O histórico das tarefas concluídas fica, e o prefixo ${atual.source.project} segue reservado enquanto esse histórico existir. Não há como desfazer.`,
      }),
    ]);
    const remover = el("button", { type: "button", texto: "Remover projeto" });
    remover.addEventListener("click", async () => {
      if (!window.confirm(`Remover o projeto ${nome}? A configuração some e não volta sozinha.`)) return;
      try {
        const resposta = await api("POST", `/projetos/${encodeURIComponent(nome)}/remocao`, { confirmar: nome });
        const reservado = resposta.prefixoReservado
          ? ` O prefixo ${resposta.prefixoReservado} segue reservado pelo histórico.`
          : "";
        [...seletor.options].find((o) => o.value === nome)?.remove();
        mensagem.textContent = `Projeto ${nome} removido.${reservado}`;
        if (seletor.options.length > 0) {
          seletor.value = seletor.options[0].value;
          await carregar();
        } else {
          corpo.replaceChildren(el("p", { texto: "Nenhum projeto configurado." }));
        }
      } catch (erro) {
        mensagem.textContent = erro.message;
      }
    });
    remocaoBox.append(el("div", { class: "acoes-cartao" }, [remover]));
    // Modo leitura (fatia 02): a configuração aparece travada; "Editar configuração" libera o formulário.
    const formulario = el("fieldset", { class: "projeto-config-form" }, [
      etapasBox,
      fonteSec,
      perfisSec,
      pessoasSec,
      repositoriosSec,
      provedoresSec,
      ensaioSec,
    ]);
    const editar = el("button", { type: "button", texto: "Editar configuração" });
    const cancelar = el("button", { type: "button", texto: "Cancelar" });
    // A barra de salvar só existe durante a edição: é o único lugar onde se grava a configuração do projeto.
    const barraSalvar = el("div", { class: "barra-salvar" }, [
      el("p", { class: "barra-salvar-texto", texto: "Alterações não salvas ficam só nesta tela." }),
      el("div", { class: "acoes-cartao" }, [cancelar, salvar]),
    ]);
    const aplicarEstado = (editando) => {
      const estado = estadoDoFormulario(editando);
      formulario.disabled = estado.formularioTravado;
      editar.hidden = !estado.editarVisivel;
      barraSalvar.hidden = !estado.cancelarVisivel;
    };
    aplicarEstado(false);
    editar.addEventListener("click", () => aplicarEstado(true));
    cancelar.addEventListener("click", () => carregar().catch((erro) => (mensagem.textContent = erro.message)));

    // Subnavegação: mesma ordem do DOM. Cada item rola até a seção correspondente.
    const ancoras = [
      ["estado", "Estado", situacaoBox],
      ["agente", "Agente por etapa", etapasBox],
      ["fonte", "Fonte de demandas", fonteSec],
      ["perfis", "Perfis", perfisSec],
      ["pessoas", "Pessoas", pessoasSec],
      ["repositorios", "Repositórios", repositoriosSec],
      ["provedores", "Provedores", provedoresSec],
      ["ensaio", "Ensaio e Telegram", ensaioSec],
      ["historico", "Histórico", historicoSec],
      ["remocao", "Remover", remocaoBox],
    ];
    for (const [id, , no] of ancoras) no.id = `projeto-secao-${id}`;
    const subnav = el(
      "nav",
      { class: "projeto-subnav", "aria-label": "Seções do projeto" },
      ancoras.map(([id, titulo]) => {
        const item = el("button", { type: "button", texto: titulo });
        item.addEventListener("click", () =>
          document.getElementById(`projeto-secao-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
        return item;
      }),
    );

    const rotuloEstado = { ativo: "Ativo", pausado: "Pausado" }[situacao.estado] ?? "Incompleto";
    const cabecalhoProjeto = el("header", { class: "projeto-cabecalho" }, [
      el("div", { class: "projeto-titulo" }, [
        el("h3", { texto: nome }),
        el("span", {
          class: `estado-selo estado-${situacao.estado === "ativo" || situacao.estado === "pausado" ? situacao.estado : "incompleto"}`,
          texto:
            pendencias.length === 0
              ? rotuloEstado
              : `${rotuloEstado} · ${pendencias.length} ${pendencias.length === 1 ? "pendência" : "pendências"}`,
        }),
      ]),
      el("div", { class: "acoes-cartao" }, [editar]),
    ]);

    corpo.replaceChildren(
      cabecalhoProjeto,
      el("div", { class: "projeto-layout" }, [
        subnav,
        el("div", { class: "projeto-secoes" }, [situacaoBox, formulario, historicoSec, remocaoBox]),
      ]),
      barraSalvar,
    );
  }

  seletor.addEventListener("change", () => carregar().catch((erro) => (mensagem.textContent = erro.message)));
  await carregar();
}

/**
 * Seção global do Telegram do usuário (fatia 09): chat, usuário autorizado e a credencial do bot no cofre. Não mostra
 * o token; ele fica no cofre e é lido pela fábrica no startup.
 */
async function desenharTelegram(box, mensagemDe, seletorDeCredencial) {
  let salvo = {};
  try {
    salvo = await api("GET", "/telegram/configuracao");
  } catch {
    salvo = {};
  }
  const chat = el("input", { valor: salvo.chat ?? "", "aria-label": "Chat do Telegram", placeholder: "id do chat" });
  const usuario = el("input", {
    valor: salvo.usuario ?? "",
    "aria-label": "Usuário autorizado",
    placeholder: "id do usuário",
  });
  const credencial = seletorDeCredencial("Credencial do bot no cofre", salvo.credential ?? "");
  const salvar = el("button", { type: "button", class: "primario", texto: "Salvar Telegram" });
  salvar.addEventListener("click", async () => {
    try {
      await api("PUT", "/telegram/configuracao", {
        chat: chat.value.trim(),
        usuario: usuario.value.trim(),
        ...(credencial.value ? { credential: credencial.value } : {}),
      });
      mensagemDe().textContent = "Telegram salvo.";
    } catch (erro) {
      mensagemDe().textContent = erro.message;
    }
  });
  box.replaceChildren(
    cabecalhoCartao(
      "Telegram (interface de gestão)",
      "Canal de gestão do usuário. O token do bot fica no cofre; esta tela guarda só o nome da credencial.",
    ),
    el("div", { class: "grade-campos" }, [
      rotulado("Chat", chat),
      rotulado("Usuário autorizado", usuario),
      rotulado("Credencial do bot", credencial),
    ]),
    el("div", { class: "acoes-cartao" }, [salvar]),
  );
}
