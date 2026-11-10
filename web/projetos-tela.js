// Tela de configuração de projeto: monta o formulário a partir da API e grava pela API (ADR-0017). Não há regra de
// negócio aqui: a API valida tudo; esta tela só converte valores (ver projeto-config.js, testado em Node).
import { api } from "./api.js";
import { desenharEtapasAgente } from "./etapas-agente-tela.js";
import {
  camposDaFonte,
  configDoFormulario,
  estadoDoFormulario,
  fonteDoFormulario,
  perfisDoFormulario,
  pessoasDoFormulario,
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

/**
 * Monta a tela dentro de `raiz`. Carrega a lista de projetos, o schema das Fontes e os modelos de perfis.
 * @param {HTMLElement} raiz
 */
export async function iniciarProjetos(raiz) {
  const [projetos, fontes, modelos] = await Promise.all([
    api("GET", "/projetos"),
    api("GET", "/integracoes/fontes"),
    api("GET", "/perfis/modelos"),
  ]);
  const mensagem = el("p", { class: "mensagem", role: "status" });
  const seletor = el(
    "select",
    { id: "projeto-config-nome", "aria-label": "Projeto" },
    projetos.map((p) => el("option", { valor: p.nome, texto: p.nome })),
  );
  const corpo = el("div", { class: "projeto-config-corpo" });
  const telegramBox = el("section", { class: "bloco" });
  raiz.replaceChildren(
    telegramBox,
    el("div", { class: "projeto-config-topo" }, [
      el("label", { for: "projeto-config-nome", texto: "Projeto " }),
      seletor,
    ]),
    mensagem,
    corpo,
  );
  desenharTelegram(telegramBox, () => mensagem);

  async function carregar() {
    const nome = seletor.value;
    if (!nome) return;
    const [atual, pendencias, historico, catalogo] = await Promise.all([
      api("GET", `/projetos/${encodeURIComponent(nome)}/configuracao`),
      api("GET", `/projetos/${encodeURIComponent(nome)}/pendencias`),
      api("GET", `/projetos/${encodeURIComponent(nome)}/historico`),
      api("GET", "/ferramentas"),
    ]);
    desenhar(nome, atual, pendencias, historico, catalogo);
  }

  function desenhar(nome, atual, pendencias, historico, catalogo) {
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
          const input = el("input", { id: `campo-${c.campo}`, valor: c.valor, "aria-label": c.rotulo });
          inputs.campos[c.campo] = { input, tipo: c.tipo, esquema: c };
          return el("label", { class: "campo" }, [el("span", { texto: c.rotulo }), input]);
        }),
      );
    }
    tipoSel.addEventListener("change", desenharCampos);
    desenharCampos();

    const credencialNome = el("input", { "aria-label": "Nome da credencial no cofre", placeholder: "ex.: jira-token" });
    const credencialValor = el("input", { type: "password", "aria-label": "Valor da credencial", autocomplete: "off" });
    const salvarCredencial = el("button", { type: "button", texto: "Salvar credencial" });
    salvarCredencial.addEventListener("click", async () => {
      try {
        await api("PUT", `/segredos/${encodeURIComponent(credencialNome.value.trim())}`, {
          valor: credencialValor.value,
        });
        credencialValor.value = "";
        mensagem.textContent = "Credencial gravada. O valor não é exibido de novo.";
      } catch (erro) {
        mensagem.textContent = erro.message;
      }
    });

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
      perfisBox.append(el("div", { class: "linha" }, [n, p]));
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
      pessoasBox.append(el("div", { class: "linha" }, campos));
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
      repoBox.append(el("div", { class: "linha" }, [linha.path, linha.prefix, linha.comando]));
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

    const ensaio = el("input", { type: "checkbox", id: "projeto-config-ensaio", marcado: atual.dryRun === true });
    // Conteúdo das mensagens deste projeto no Telegram (fatia 09): completo ou mínimo.
    const conteudoTelegram = el("select", { "aria-label": "Conteúdo no Telegram" }, [
      el("option", { valor: "full", texto: "completo" }),
      el("option", { valor: "minimal", texto: "mínimo" }),
    ]);
    conteudoTelegram.value = atual.telegram?.content ?? "full";
    const salvar = el("button", { type: "button", texto: "Salvar configuração" });
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
          repositorios: atual.repositories || repositorios.length > 0 ? repositorios : undefined,
          etapas: lerEtapas(),
          skills: lerSkills(),
          mcpServers: lerServidores(),
        });
        await api("PUT", `/projetos/${encodeURIComponent(nome)}/configuracao`, nova);
        mensagem.textContent = "Configuração salva.";
        await carregar();
      } catch (erro) {
        mensagem.textContent = erro.message;
      }
    });

    const etapasBox = el("section", { class: "bloco" });
    const { lerEtapas, lerSkills, lerServidores } = desenharEtapasAgente(etapasBox, atual, catalogo, el);

    const secoes = [
      etapasBox,
      el("section", { class: "bloco" }, [
        el("h3", { texto: "Fonte de demandas" }),
        el("label", { class: "campo" }, [el("span", { texto: "Tipo" }), tipoSel]),
        camposBox,
        el("h4", { texto: "Credencial (valor não é exibido depois de salvo)" }),
        el("div", { class: "linha" }, [credencialNome, credencialValor, salvarCredencial]),
      ]),
      el("section", { class: "bloco" }, [el("h3", { texto: "Perfis" }), modelosBox, adicionarPerfil, perfisBox]),
      el("section", { class: "bloco" }, [el("h3", { texto: "Pessoas do projeto" }), adicionarPessoa, pessoasBox]),
      el("section", { class: "bloco" }, [el("h3", { texto: "Repositórios locais" }), adicionarRepo, repoBox]),
      el("section", { class: "bloco" }, [
        el("label", {}, [ensaio, el("span", { texto: " Ensaio (dry-run): registra as escritas sem aplicá-las" })]),
        el("label", { class: "campo" }, [el("span", { texto: "Conteúdo no Telegram" }), conteudoTelegram]),
        salvar,
      ]),
      el("section", { class: "bloco" }, [
        el("h3", { texto: "Pendências" }),
        el(
          "ul",
          {},
          pendencias.length === 0
            ? [el("li", { texto: "Nenhuma pendência." })]
            : pendencias.map((p) => el("li", { texto: p })),
        ),
      ]),
      el("section", { class: "bloco" }, [
        el("h3", { texto: "Histórico de alterações" }),
        el(
          "ul",
          {},
          historico.length === 0
            ? [el("li", { texto: "Sem alterações." })]
            : resumoHistorico(historico).map((linha) => el("li", { texto: linha })),
        ),
      ]),
    ];
    // Modo leitura (fatia 02): a configuração aparece travada; "Editar configuração" libera o formulário.
    const formulario = el("fieldset", { class: "projeto-config-form" }, secoes);
    const editar = el("button", { type: "button", texto: "Editar configuração" });
    const cancelar = el("button", { type: "button", texto: "Cancelar edição" });
    const aplicarEstado = (editando) => {
      const estado = estadoDoFormulario(editando);
      formulario.disabled = estado.formularioTravado;
      editar.hidden = !estado.editarVisivel;
      cancelar.hidden = !estado.cancelarVisivel;
    };
    aplicarEstado(false);
    editar.addEventListener("click", () => aplicarEstado(true));
    cancelar.addEventListener("click", () => carregar().catch((erro) => (mensagem.textContent = erro.message)));
    corpo.replaceChildren(el("div", { class: "linha" }, [editar, cancelar]), formulario);
  }

  seletor.addEventListener("change", () => carregar().catch((erro) => (mensagem.textContent = erro.message)));
  await carregar();
}

/**
 * Seção global do Telegram do usuário (fatia 09): chat, usuário autorizado e a credencial do bot no cofre. Não mostra
 * o token; ele fica no cofre e é lido pela fábrica no startup.
 */
async function desenharTelegram(box, mensagemDe) {
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
  const credencial = el("input", {
    valor: salvo.credential ?? "",
    "aria-label": "Credencial do bot no cofre",
    placeholder: "ex.: telegram-bot",
  });
  const salvar = el("button", { type: "button", texto: "Salvar Telegram" });
  salvar.addEventListener("click", async () => {
    try {
      await api("PUT", "/telegram/configuracao", {
        chat: chat.value.trim(),
        usuario: usuario.value.trim(),
        ...(credencial.value.trim() ? { credential: credencial.value.trim() } : {}),
      });
      mensagemDe().textContent = "Telegram salvo.";
    } catch (erro) {
      mensagemDe().textContent = erro.message;
    }
  });
  box.replaceChildren(
    el("h3", { texto: "Telegram (interface de gestão, global ao usuário)" }),
    el("div", { class: "linha" }, [chat, usuario, credencial, salvar]),
  );
}
