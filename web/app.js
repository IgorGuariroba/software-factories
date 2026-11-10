// Página de gestão: lê e comanda a fábrica só pela API local, e se atualiza pelo stream de eventos (SSE).
// O DOM é montado com createElement e textContent: conteúdo do card e do modelo nunca vira HTML.
import {
  answerQuestion,
  approveQuestion,
  approveReminder,
  approveRetro,
  approveSpec,
  cancelTask,
  criarProjetoGithub,
  criarProjetoGitlab,
  decideTriage,
  enviarMensagemEtapa,
  esquecerMemoriaEtapa,
  eventStream,
  getDaemon,
  getGithubApp,
  getGithubRepos,
  getIntegracoesFontes,
  getQuestionPreview,
  getQueue,
  getReminderPreview,
  getRepos,
  getRetroPreview,
  getRetroSettings,
  getSegredos,
  getSpecPreview,
  getTask,
  getTasks,
  getTrace,
  getTriagePreview,
  importarRepoGithub,
  listarPessoasDaFonte,
  pauseDaemon,
  pauseTask,
  plugRepo,
  pollSource,
  reorderTasks,
  resumeDaemon,
  resumeTask,
  saveRetroSettings,
  unplugRepo,
  vetoTask,
} from "./api.js";
import { alertaGithubApp, etapasGithubApp, linhasGithubApp, progressoGithubApp } from "./github-app.js";
import { ICONES } from "./icones.js";
import { renderImplementation } from "./implementation.js";
import { fonteDoFormulario, opcoesDeCredenciais } from "./projeto-config.js";
import { iniciarProjetos } from "./projetos-tela.js";
import { linhasRepositorios, mensagemTarefasAtivas } from "./repositorios.js";
import {
  camposDaFonteNaCriacao,
  comandoDoTexto,
  corpoProjetoGitlab,
  estadoImportacao,
  filtrarCatalogo,
  mensagemCatalogo,
  mensagemCriacao,
  opcoesDePessoas,
  pessoasDoFormulario,
  sugerirProjeto,
  temImportacaoEmAndamento,
  textoImportacao,
  visibilidade,
} from "./repositorios-github.js";
import { renderTrace } from "./trace.js";
import {
  actionsFor,
  actionTab,
  activity,
  boardColumns,
  canAnswerQuestion,
  cardHint,
  detailStatusLabel,
  isTerminal,
  moveTask,
  nextAction,
  pipelineSteps,
  proposalLabel,
  refreshSelectedDetail,
  retroStageLabel,
  retroStatusLabel,
  stageLabel,
  statusLabel,
  taskByRef,
  writeSituation,
} from "./view.js";
import { priorityTasks, visibleTasks, workspaceCounts } from "./workspace.js";

const $ = (id) => document.getElementById(id);

/**
 * Cria um elemento com texto e atributos; os filhos podem ser elementos ou texto.
 * @param {string} tag
 * @param {{ text?: string, className?: string, attrs?: Record<string, string>, onClick?: () => void }} [opts]
 * @param {(Node | string)[]} children
 */
function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.icon) node.append(svgIcon(opts.icon));
  if (opts.className) node.className = opts.className;
  for (const [name, value] of Object.entries(opts.attrs ?? {})) node.setAttribute(name, value);
  if (opts.onClick) node.addEventListener("click", opts.onClick);
  node.append(...children);
  return node;
}

const formatTime = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "");

let tasks = [];
let taskFilter = "todas";
let taskView = "lista";
let daemonPaused = false;
/** Tarefa aberta no detalhe, pelo hash `#/tarefa/<projeto>/<card>`. */
let selected = null;
let detailReturn = "tarefas";
/** Id opaco de uma issue da fábrica colado na página (`#/retro/<id>`), resolvido para a Tarefa quando a lista chega. */
let pendingRef = null;

function showError(err) {
  const aviso = $("aviso");
  aviso.textContent = err instanceof Error ? err.message : String(err);
  aviso.hidden = false;
}

function clearError() {
  $("aviso").hidden = true;
}

/** Executa um comando e atualiza a página (o SSE também atualiza, mas a resposta imediata evita atraso). */
async function run(command) {
  try {
    await command();
    clearError();
  } catch (err) {
    showError(err);
  }
  await refresh();
}

/** Rascunhos das respostas persistem no redesenho; servidor classifica a resposta. */
const answerDrafts = new Map();

function answerQuestionControls(task, question) {
  const id = `${task.id}#${question.n}`;
  const field = el("textarea", {
    attrs: {
      rows: "3",
      maxlength: "20000",
      "aria-label": `Resposta à pergunta ${question.n}`,
      placeholder: "Sua resposta",
    },
  });
  field.value = answerDrafts.get(id) ?? "";
  field.addEventListener("input", () => answerDrafts.set(id, field.value));
  const button = el("button", { text: "Responder", attrs: { type: "button" } });
  button.addEventListener("click", async () => {
    const answer = field.value.trim();
    if (!answer || answer.length > 20000)
      return showError(new Error("A resposta deve ter entre 1 e 20000 caracteres."));
    button.disabled = true;
    field.disabled = true;
    try {
      await answerQuestion(task.project, task.key, question.n, answer);
      answerDrafts.delete(id);
      clearError();
      await refresh();
    } catch (err) {
      showError(err);
    } finally {
      button.disabled = false;
      field.disabled = false;
    }
  });
  return el("div", {}, el("label", { text: "Sua resposta" }), field, button);
}

function reviewReminderButton(task, question) {
  const container = el("div");
  const button = el("button", {
    text: "Revisar lembrete",
    attrs: { type: "button" },
    onClick: async () => {
      button.disabled = true;
      try {
        const preview = await getReminderPreview(task.project, task.key, question.n);
        if (!container.isConnected) return;
        container.replaceChildren(
          el("p", { text: `Lembrete no Jira (${preview.card}):` }),
          el("pre", { className: "texto", text: preview.comment }),
          preview.dryRun
            ? el("p", { text: "Dry-run: a publicação real está desativada." })
            : el("button", {
                text: "Aprovar lembrete",
                attrs: { type: "button" },
                onClick: () => run(() => approveReminder(task.project, task.key, question.n, preview.revision)),
              }),
        );
        clearError();
      } catch (err) {
        button.disabled = false;
        showError(err);
      }
    },
  });
  container.append(button);
  return container;
}

function reviewTriageButton(task) {
  const container = el("div");
  const button = el("button", {
    text: "Revisar triagem",
    attrs: { type: "button" },
    onClick: async () => {
      button.disabled = true;
      try {
        const p = await getTriagePreview(task.project, task.key);
        if (!container.isConnected) return;
        const decide = (decision) => run(() => decideTriage(task.project, task.key, decision, p.revision));
        container.replaceChildren(
          el("p", { text: `Triagem (${p.by}): ${p.verdict}, ${p.category}. ${p.reason}` }),
          el("p", { text: `Se recusar, comenta na issue e fecha como ${p.closeAs}:` }),
          el("pre", { className: "texto", text: p.comment }),
          el("button", {
            text: "Aceitar e seguir para a SPEC",
            attrs: { type: "button" },
            onClick: () => decide("aceitar"),
          }),
          p.dryRun
            ? el("p", { text: "Dry-run: a recusa real está desativada." })
            : el("button", {
                text: "Recusar e fechar a issue",
                attrs: { type: "button" },
                onClick: () => decide("recusar"),
              }),
        );
        clearError();
      } catch (err) {
        button.disabled = false;
        showError(err);
      }
    },
  });
  container.append(button);
  return container;
}

function reviewSpecButton(task) {
  const container = el("div");
  const button = el("button", {
    text: "Revisar SPEC e Tickets",
    attrs: { type: "button" },
    onClick: async () => {
      button.disabled = true;
      try {
        const preview = await getSpecPreview(task.project, task.key);
        if (!container.isConnected) return;
        container.replaceChildren(
          el("p", { text: `SPEC e Tickets de ${preview.card}:` }),
          el("p", {
            text: preview.dryRun
              ? "Dry-run: a aprovação é local e continua o ensaio, sem publicar na Fonte."
              : "A aprovação libera a continuação e a publicação na Fonte conforme a configuração do projeto.",
          }),
          el("button", {
            text: preview.dryRun ? "Aprovar e continuar dry-run" : "Aprovar SPEC e Tickets",
            attrs: { type: "button" },
            onClick: () => run(() => approveSpec(task.project, task.key, preview.revision)),
          }),
          el("pre", { className: "texto", text: preview.spec }),
          el("pre", { className: "texto", text: preview.tickets }),
        );
        clearError();
      } catch (err) {
        button.disabled = false;
        showError(err);
      }
    },
  });
  container.append(button);
  return container;
}

function reviewQuestionButton(task, question) {
  const container = el("div");
  const button = el("button", {
    text: "Revisar pergunta e aviso",
    attrs: { type: "button" },
    onClick: async () => {
      button.disabled = true;
      try {
        const preview = await getQuestionPreview(task.project, task.key, question.n);
        if (!container.isConnected) return;
        container.replaceChildren(
          el("p", { text: `Comentário no Jira (${preview.card}):` }),
          el("pre", { className: "texto", text: preview.comment }),
          el("p", {
            text: preview.teamsUserId ? `Aviso Teams para ${preview.teamsUserId}:` : "Sem aviso Teams configurado.",
          }),
          ...(preview.teamsMessage ? [el("pre", { className: "texto", text: preview.teamsMessage })] : []),
          preview.dryRun
            ? el("p", { text: "Dry-run: a publicação real está desativada." })
            : el("button", {
                text: "Aprovar pergunta e aviso",
                attrs: { type: "button" },
                onClick: () => run(() => approveQuestion(task.project, task.key, question.n, preview.revision)),
              }),
        );
        clearError();
      } catch (err) {
        button.disabled = false;
        showError(err);
      }
    },
  });
  container.append(button);
  return container;
}

function reviewRetroButton(task, retro, proposal) {
  const container = el("div");
  const button = el("button", {
    text: "Revisar publicação pública",
    attrs: { type: "button" },
    onClick: async () => {
      button.disabled = true;
      try {
        const preview = await getRetroPreview(task.project, task.key, retro.stage, proposal.n);
        if (!container.isConnected) return;
        container.replaceChildren(
          el("p", { text: `Destino público: ${preview.repo}${preview.dryRun ? " (dry-run)" : ""}` }),
          el("p", { text: "Revise todo o texto. Se houver issue semelhante, a fábrica pode apenas comentar +1 nela." }),
          el("strong", { text: preview.title }),
          el("pre", { className: "texto", text: preview.body }),
          preview.blocked
            ? el("p", { text: "A publicação está bloqueada: o texto ainda pode conter valores privados." })
            : el("button", {
                text: "Aprovar publicação",
                attrs: { type: "button" },
                onClick: () =>
                  run(() => approveRetro(task.project, task.key, retro.stage, proposal.n, preview.revision)),
              }),
        );
        clearError();
      } catch (err) {
        button.disabled = false;
        const message = err instanceof Error ? err.message : String(err);
        let notice = container.querySelector('[role="status"]');
        if (!notice) {
          notice = el("p", { attrs: { role: "status" } });
          container.append(notice);
        }
        notice.textContent =
          message === "repositório da fábrica não configurado"
            ? "Publicação opcional indisponível: escolha o repositório em Configurar publicações. Isso não impede retomar a tarefa."
            : `Não foi possível revisar esta publicação opcional: ${message}`;
        if (
          message === "repositório da fábrica não configurado" &&
          !container.querySelector("[data-configurar-retros]")
        )
          container.append(
            el("button", {
              text: "Configurar repositório",
              attrs: { type: "button", "data-configurar-retros": "" },
              onClick: () => {
                location.hash = "#/configuracoes";
              },
            }),
          );
      }
    },
  });
  container.append(button);
  return container;
}

const ACTIONS = {
  vetar: { label: "Vetar", danger: true, run: (t) => vetoTask(t.project, t.key) },
  pausar: { label: "Pausar", run: (t) => pauseTask(t.project, t.key) },
  retomar: {
    label: "Retomar",
    confirm: (t) =>
      t.status === "bloqueada"
        ? `Retomar ${t.key}? Confirme que a causa do bloqueio foi corrigida. A fábrica continuará do checkpoint e poderá executar ações reais; os guardrails serão verificados novamente.`
        : null,
    run: (t) => resumeTask(t.project, t.key),
  },
  cancelar: {
    label: "Cancelar",
    danger: true,
    confirm: (t) => `Cancelar a tarefa do card ${t.key}?`,
    run: (t) => cancelTask(t.project, t.key),
  },
};

function actionButtons(task) {
  return actionsFor(task).map((name) => {
    const action = ACTIONS[name];
    return el("button", {
      text: action.label,
      className: action.danger ? "perigo" : "",
      attrs: { type: "button", "aria-label": `${action.label} ${task.key}` },
      onClick: () => {
        const confirmation = action.confirm?.(task);
        if (confirmation && !window.confirm(confirmation)) return;
        run(() => action.run(task));
      },
    });
  });
}

/* Ícones Lucide (web/icones.js), 16px por padrão, herdam a cor do texto. Montados por DOM, sem HTML a partir de string. */
const SVG_NS = "http://www.w3.org/2000/svg";
function svgIcon(name, tamanho = 16) {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [attr, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: String(tamanho),
    height: String(tamanho),
    "aria-hidden": "true",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }))
    svg.setAttribute(attr, value);
  for (const [tag, attrs] of ICONES[name] ?? []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [attr, value] of Object.entries(attrs)) node.setAttribute(attr, value);
    svg.append(node);
  }
  return svg;
}

/* Ícones estáticos da página: <span data-icone="nome"> recebe o SVG da biblioteca. */
for (const slot of document.querySelectorAll("[data-icone]")) slot.replaceChildren(svgIcon(slot.dataset.icone));

function moveButton(task, delta) {
  const order = moveTask(tasks, task.id, delta);
  const label = delta < 0 ? "Subir" : "Descer";
  const button = el("button", {
    className: "mover-botao",
    icon: delta < 0 ? "arrow-up" : "arrow-down",
    attrs: { type: "button", title: label, "aria-label": `${label} ${task.key} na fila` },
    onClick: () => order && run(() => reorderTasks(order)),
  });
  button.addEventListener("click", (e) => e.preventDefault());
  button.disabled = order === null;
  return button;
}

function statusPill(task) {
  const tone = task.status === "bloqueada" ? "perigo" : isTerminal(task) || task.status === "ativa" ? "ok" : "alerta";
  return el("span", { className: `selo ${tone}`, text: statusLabel(task.status) });
}

function taskCard(task) {
  const isSelected = selected && task.project === selected.project && task.key === selected.key;
  const open = !isTerminal(task);
  const hint = cardHint(task);
  const card = el(
    "a",
    {
      className: `cartao${isSelected ? " selecionada" : ""}${hint?.yourTurn ? " sua-vez" : ""}`,
      attrs: {
        href: `#/tarefa/${encodeURIComponent(task.project)}/${encodeURIComponent(task.key)}`,
        ...(isSelected ? { "aria-current": "page" } : {}),
      },
    },
    el(
      "span",
      { className: "cabeca" },
      el("span", { className: "chave", text: task.key }),
      el("span", { className: "projeto", text: task.project }),
    ),
    el("span", { className: "titulo", text: task.title }),
    ...(hint ? [el("span", { className: "dica", text: hint.text })] : []),
    el(
      "span",
      { className: "meta" },
      statusPill(task),
      el("span", { className: "tentativas", text: `${task.attempts}×` }),
      ...(open ? [el("span", { className: "mover" }, moveButton(task, -1), moveButton(task, 1))] : []),
    ),
  );
  return el("li", {}, card);
}

/**
 * Linha de tarefa única, usada pela Visão Geral (triagem) e pela lista de Tarefas:
 * mesma ordem de colunas, mesma densidade. `origem` é a página de volta ao fechar o detalhe.
 */
function taskRow(task, origem) {
  const hint = cardHint(task);
  const isSelected = selected && task.project === selected.project && task.key === selected.key;
  const link = el(
    "a",
    {
      className: "linha-link",
      attrs: {
        href: `#/tarefa/${encodeURIComponent(task.project)}/${encodeURIComponent(task.key)}`,
        ...(isSelected ? { "aria-current": "page" } : {}),
      },
    },
    // Colunas com largura fixa (identificação, subtítulo, estado, contador): os títulos começam na mesma coordenada.
    el(
      "span",
      { className: "linha-id" },
      el("span", {
        className: `linha-ponto ${task.status === "bloqueada" ? "bloqueada" : hint?.yourTurn ? "atencao" : ""}`,
      }),
      el("span", { className: "linha-chave", text: task.key }),
      el("span", { className: "linha-projeto", text: task.project }),
    ),
    el("span", { className: "linha-titulo", text: task.title }),
    el("span", { className: "linha-subtitulo", text: hint?.text ?? "" }),
    el("span", { className: "linha-estado" }, statusPill(task)),
    el("span", { className: "linha-contador", text: `${task.attempts}×`, attrs: { title: "tentativas" } }),
  );
  link.addEventListener("click", () => {
    detailReturn = origem;
  });
  const actions = el("div", { className: "linha-acoes" });
  if (task.status === "bloqueada" && actionsFor(task).includes("retomar")) {
    const resume = actionButtons(task).find((button) => button.textContent === "Retomar");
    if (resume) actions.append(resume);
  }
  if (!isTerminal(task)) actions.append(moveButton(task, -1), moveButton(task, 1));
  return el(
    "li",
    { className: `linha-tarefa${isSelected ? " selecionada" : ""}${hint?.yourTurn ? " sua-vez" : ""}` },
    link,
    actions,
  );
}

function renderTasks() {
  const visible = visibleTasks(tasks, taskFilter, $("busca-tarefas").value);
  const overview = priorityTasks(visibleTasks(tasks, taskFilter, ""));
  $("triagem-lista").replaceChildren(...overview.map((task) => taskRow(task, "inicio")));
  $("triagem-vazia").hidden = overview.length > 0;
  const counts = workspaceCounts(tasks);
  for (const [key, count] of Object.entries(counts)) $(`total-${key}`).textContent = String(count);
  for (const button of document.querySelectorAll("[data-filtro]"))
    button.setAttribute("aria-pressed", String(button.dataset.filtro === taskFilter));
  for (const button of document.querySelectorAll("[data-modo]"))
    button.setAttribute("aria-pressed", String(button.dataset.modo === taskView));
  $("resultado-contagem").textContent =
    `${visible.length} de ${tasks.length} · ${taskView === "lista" ? "pendências primeiro" : "por etapa"}`;
  $("quadro").classList.toggle("modo-lista", taskView === "lista");
  const columns = boardColumns(visible);
  $("quadro").replaceChildren(
    ...columns.map((c) =>
      el(
        "section",
        { className: "coluna", attrs: { "data-coluna": c.key, "aria-label": c.label } },
        el(
          "h3",
          {},
          el("span", { className: "ponto" }),
          c.label,
          el("span", { className: "contagem", text: String(c.tasks.length) }),
        ),
        ...(c.tasks.length === 0 ? [el("p", { className: "coluna-vazia", text: "Nenhuma tarefa nesta etapa." })] : []),
        el("ol", { className: "cartoes" }, ...c.tasks.map(taskCard)),
      ),
    ),
  );
  if (taskView === "lista")
    $("quadro").replaceChildren(
      el(
        "ol",
        { className: "linha-lista", attrs: { "aria-label": "Lista de tarefas" } },
        ...priorityTasks(visible).map((task) => taskRow(task, "tarefas")),
      ),
    );
  const open = tasks.filter((t) => !isTerminal(t)).length;
  $("fila-contagem").textContent = `(${open} em andamento)`;
  $("fila-vazia").hidden = visible.length > 0;
}

function renderDaemon() {
  const badge = $("daemon");
  badge.textContent = daemonPaused ? "Daemon pausado" : "Daemon ativo";
  badge.className = `selo ${daemonPaused ? "alerta" : "ok"}`;
  const toggle = $("alternar-daemon");
  toggle.textContent = daemonPaused ? "Retomar daemon" : "Pausar daemon";
  toggle.disabled = false;
}

let openedTask = null;
/** Etapa escolhida na aba Trace e a última tarefa aberta, para atualizar o trace enquanto ela roda. */
let etapaTrace = null;
let detalheAtual = null;
let traceTimer = null;

async function atualizarTrace(task) {
  clearTimeout(traceTimer);
  if (!task || currentTab !== "trace") return;
  const alvo = task.id;
  try {
    const etapas = await getTrace(task.project, task.key);
    if (detalheAtual?.id !== alvo || currentTab !== "trace") return;
    renderTrace($("detalhe-trace"), etapas, etapaTrace, el, {
      aoEscolher: (nome) => {
        etapaTrace = nome;
        atualizarTrace(detalheAtual);
      },
      aoEsquecer: async (nome) => {
        try {
          await esquecerMemoriaEtapa(detalheAtual.project, detalheAtual.key, nome);
        } catch (erro) {
          showError(erro);
        }
        atualizarTrace(detalheAtual);
      },
      aoEnviar: async (nome, texto) => {
        try {
          await enviarMensagemEtapa(detalheAtual.project, detalheAtual.key, nome, texto);
        } catch (erro) {
          showError(erro);
        }
        atualizarTrace(detalheAtual);
      },
    });
  } catch {
    if (detalheAtual?.id === alvo)
      $("detalhe-trace").replaceChildren(el("p", { text: "Não foi possível carregar o trace." }));
  }
  if (detalheAtual?.id === alvo && !isTerminal(detalheAtual))
    traceTimer = setTimeout(() => atualizarTrace(detalheAtual), 3000);
}

function renderDetail(task) {
  detalheAtual = task;
  const opening = openedTask !== task.id || $("detalhe").hidden;
  const focused = document.activeElement;
  const editing =
    focused?.matches("textarea") && $("detalhe").contains(focused)
      ? { label: focused.getAttribute("aria-label"), start: focused.selectionStart, end: focused.selectionEnd }
      : null;
  if (openedTask !== task.id) {
    openedTask = task.id;
    $("menu-acoes-tarefa").open = false;
    showTab(actionTab(task));
  }
  $("titulo-detalhe").textContent = task.title;
  $("detalhe-ref").textContent = `${task.project} · ${task.key}`;
  const facts = [stageLabel(task.stage), `${task.attempts} tentativa(s)`];
  if (task.pauseRequested && task.status !== "pausada") facts.push("pausa pedida; para no próximo passo");
  if (task.vetoUntil) facts.push(`veto até ${formatTime(task.vetoUntil)}`);
  $("detalhe-estado").replaceChildren(
    el("span", { className: statusPill(task).className, text: detailStatusLabel(task) }),
    ...facts.map((f) => el("span", { text: `· ${f}` })),
  );
  const next = nextAction(task);
  const proximo = $("detalhe-proximo");
  proximo.hidden = next === null;
  proximo.replaceChildren(
    next ?? "",
    ...(next
      ? [
          el("button", {
            text: actionsFor(task).includes("retomar") ? "Retomar tarefa" : "Ver próxima ação",
            attrs: { type: "button" },
            onClick: () => {
              if (actionsFor(task).includes("retomar")) {
                const confirmation = ACTIONS.retomar.confirm(task);
                if (confirmation && !window.confirm(confirmation)) return;
                run(() => resumeTask(task.project, task.key));
                return;
              }
              showTab(actionTab(task));
              document.querySelector(`[data-painel="${actionTab(task)}"]`)?.scrollIntoView({ block: "nearest" });
            },
          }),
        ]
      : []),
  );
  proximo.className = `proximo${task.status === "bloqueada" ? " bloqueado" : ""}`;
  const STATE = {
    feito: "concluída",
    atual: "em andamento",
    espera: "aguardando",
    bloqueado: "bloqueada",
    pendente: "",
  };
  const steps = pipelineSteps(task);
  const currentStep = steps.find((s) => ["atual", "espera", "bloqueado"].includes(s.state));
  $("etapa-atual").textContent = currentStep
    ? `${steps.indexOf(currentStep) + 1} de ${steps.length} · ${currentStep.label}`
    : task.status === "concluida"
      ? "Fluxo concluído"
      : stageLabel(task.stage);
  $("detalhe-pipeline").replaceChildren(
    ...steps.map((s) =>
      el(
        "li",
        { className: s.state, attrs: s.state === "atual" || s.state === "espera" ? { "aria-current": "step" } : {} },
        el("button", {
          text: s.label,
          attrs: { type: "button" },
          onClick: () =>
            showTab(
              {
                triagem: "spec",
                spec: "spec",
                implementacao: "implementacao",
                review: "implementacao",
                entrega: "implementacao",
                merge: "implementacao",
              }[s.key],
            ),
        }),
        el("span", { className: "estado-etapa", text: STATE[s.state] }),
      ),
    ),
  );
  const taskActions = actionButtons(task);
  $("detalhe-acoes").replaceChildren(...taskActions);
  $("menu-acoes-tarefa").hidden = taskActions.length === 0;

  $("detalhe-perguntas").replaceChildren(
    ...(task.questions.length === 0
      ? [el("li", { className: "vazio", text: "Nenhuma pergunta." })]
      : task.questions.map((q) =>
          el(
            "li",
            {},
            el("span", { className: "quando", text: formatTime(q.askedAt) }),
            `${q.n}. para ${q.to}: ${q.text} `,
            el("strong", {
              text:
                q.publication === "draft"
                  ? "(aguarda revisão)"
                  : q.publication === "sending"
                    ? "(publicação não confirmada; verifique o card na Fonte)"
                    : q.answer === null
                      ? "(pendente)"
                      : `Resposta: ${q.answer}`,
            }),
            ...(q.publication === "draft" ? [reviewQuestionButton(task, q)] : []),
            ...(canAnswerQuestion(task, q)
              ? [
                  el("p", {
                    className: "vazio",
                    text: "Responda por aqui para continuar. A resposta fica na fábrica, sem enviar mensagem aos canais externos.",
                  }),
                  answerQuestionControls(task, q),
                ]
              : []),
            ...(q.reminder === "draft" && q.answer === null ? [reviewReminderButton(task, q)] : []),
            ...(q.reminder === "sending"
              ? [el("p", { text: "Lembrete não confirmado; verifique o card na Fonte." })]
              : []),
            ...(q.teamsNotice === "uncertain" || q.teamsNotice === "attempted"
              ? [el("p", { text: "Aviso Teams não confirmado; verifique o chat antes de reenviar." })]
              : []),
          ),
        )),
  );

  $("detalhe-spec").textContent =
    task.spec ?? "A SPEC ainda não foi preparada. Quando estiver disponível, você poderá consultá-la nesta seção.";
  $("detalhe-spec").classList.toggle("conteudo-vazio", !task.spec);
  $("detalhe-triagem").replaceChildren(
    ...(task.triage
      ? [
          el("p", { className: "triagem-resultado", text: `Resultado: ${task.triage.verdict}` }),
          el("p", {
            className: "vazio",
            text:
              task.triage.review === "draft"
                ? "A fábrica aguarda sua decisão antes de continuar."
                : "Consulte abaixo a justificativa registrada pela fábrica.",
          }),
          el(
            "details",
            { className: "triagem-tecnica" },
            el("summary", { text: "Justificativa e dados técnicos" }),
            el("p", { text: task.triage.reason }),
          ),
          ...(task.triage.review === "draft" ? [reviewTriageButton(task)] : []),
        ]
      : [el("p", { text: "Sem triagem (só repositório monitorado)." })]),
  );
  $("detalhe-spec-revisao").replaceChildren(
    ...(task.specReview === "draft"
      ? [el("p", { text: "SPEC e Tickets aguardam revisão." }), reviewSpecButton(task)]
      : []),
  );
  $("tickets-vazios").hidden = task.tickets.length > 0;
  $("detalhe-tickets").replaceChildren(
    ...task.tickets.map((t) => el("li", {}, el("strong", { text: t.titulo }), `: ${t.aceite}`)),
  );

  renderImplementation($("detalhe-implementacao"), task, el);

  $("detalhe-retros").replaceChildren(
    el("h3", { text: "Sugestões opcionais da retrô" }),
    el("p", {
      text: "Estas sugestões de melhoria não são aprovações obrigatórias da tarefa. Se a tarefa estiver pausada, use Retomar tarefa para continuar o fluxo.",
    }),
    ...(task.retros.length === 0
      ? [el("p", { className: "vazio", text: "Nenhuma retrô ainda." })]
      : task.retros.map((r) =>
          el(
            "div",
            {},
            el("h4", { text: `${retroStageLabel(r.stage)} (${retroStatusLabel(r.status)})` }),
            el("p", { text: r.summary ?? r.error ?? "" }),
            el(
              "ul",
              { className: "lista" },
              ...r.proposals.map((p) =>
                el(
                  "li",
                  {},
                  el("strong", { text: p.title }),
                  ` (${proposalLabel(p)}${p.issue ? `, issue #${p.issue.number}` : ""}${p.reason ? `: ${p.reason}` : ""}): `,
                  p.description,
                  ...(p.kind === "conhecimento" && p.status === "pendente"
                    ? [
                        el("p", {
                          className: "vazio",
                          text: "Aprovação de conhecimento ainda não disponível nesta interface (M1-18). A sugestão fica registrada, sem impedir a retomada da tarefa.",
                        }),
                      ]
                    : []),
                  ...(p.kind === "fabrica" && p.status === "pendente" && r.status === "concluida"
                    ? [reviewRetroButton(task, r, p)]
                    : []),
                ),
              ),
            ),
          ),
        )),
  );

  $("detalhe-escritas")
    .querySelector("tbody")
    .replaceChildren(
      ...task.writes.map((w) => {
        const situation = writeSituation(w);
        return el(
          "tr",
          {},
          el("td", { text: formatTime(w.at) }),
          el("td", {
            text: situation === "barrada" ? `barrada: ${w.reason}` : situation,
            className: situation === "barrada" ? "barrada" : situation === "dry-run" ? "dry-run" : "",
          }),
          el("td", { text: w.action }),
          el("td", { text: w.target }),
          el("td", {}, el("pre", { className: "texto", text: w.content })),
        );
      }),
    );

  $("detalhe-eventos").replaceChildren(
    ...(task.events.length === 0 ? [el("li", { className: "vazio", text: "Nenhuma atividade registrada." })] : []),
    ...activity(task.events).map((a) =>
      el(
        "li",
        {},
        el("span", { className: "quando", text: formatTime(a.at) }),
        el("span", { className: `tipo tipo-${a.kind}`, text: a.kind }),
        el("span", { text: a.text }),
      ),
    ),
  );
  const counts = {
    perguntas: task.questions.length,
    retros: task.retros.length,
    escritas: task.writes.length,
    spec: task.tickets.length,
  };
  for (const tab of document.querySelectorAll("[data-aba]")) {
    const base = tab.dataset.label ?? tab.textContent;
    tab.dataset.label = base;
    const n = counts[tab.dataset.aba];
    tab.textContent = n ? `${base} (${n})` : base;
  }
  $("detalhe").hidden = false;
  if (opening && window.matchMedia("(max-width: 960px)").matches) window.scrollTo({ top: 0, behavior: "instant" });
  $("detalhe-vazio").hidden = true;
  if (editing) {
    const field = [...document.querySelectorAll("#detalhe textarea")].find(
      (node) => node.getAttribute("aria-label") === editing.label,
    );
    if (field) {
      field.focus({ preventScroll: true });
      field.setSelectionRange(editing.start, editing.end);
    }
  }
}

let currentTab = "atividade";
function showTab(name) {
  currentTab = name;
  for (const tab of document.querySelectorAll("[data-aba]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.aba === name));
    tab.tabIndex = tab.dataset.aba === name ? 0 : -1;
    if (tab.dataset.aba === name && !$("detalhe").hidden) {
      tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    tab.id = `aba-${tab.dataset.aba}`;
    tab.setAttribute("aria-controls", `painel-${tab.dataset.aba}`);
  }
  for (const panel of document.querySelectorAll("[data-painel]")) {
    panel.id = `painel-${panel.dataset.painel}`;
    panel.setAttribute("aria-labelledby", `aba-${panel.dataset.painel}`);
  }
  for (const panel of document.querySelectorAll("[data-painel]")) panel.hidden = panel.dataset.painel !== name;
  if (name === "trace") atualizarTrace(detalheAtual);
  else clearTimeout(traceTimer);
}
for (const tab of document.querySelectorAll("[data-aba]"))
  tab.addEventListener("click", () => showTab(tab.dataset.aba));
document.querySelector(".abas").addEventListener("keydown", (event) => {
  const tabs = [...document.querySelectorAll("[data-aba]")];
  const index = tabs.indexOf(event.target);
  if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const target =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  showTab(tabs[target].dataset.aba);
  tabs[target].focus();
});
showTab(currentTab);

function showPage(page) {
  const current = ["inicio", "tarefas", "fonte", "repositorios", "projetos", "configuracoes"].includes(page)
    ? page
    : "inicio";
  const previous = document.querySelector("[data-tela]:not([hidden])")?.dataset.tela;
  document.querySelector(".visao-geral").hidden = current !== "inicio";
  for (const section of document.querySelectorAll("[data-tela]")) section.hidden = section.dataset.tela !== current;
  if (current === "configuracoes" && previous !== "configuracoes") {
    loadRetroSettings();
    loadGithubApp();
    loadRepos();
  }
  if (current === "repositorios" && previous !== "repositorios") {
    loadCatalogoGithub();
    carregarCredenciaisGitlab();
  }
  if (current === "projetos" && previous !== "projetos")
    iniciarProjetos(document.getElementById("projetos-config")).catch((erro) => console.error(erro));
  if (current !== "repositorios") pararAtualizacaoCatalogo();
  for (const link of document.querySelectorAll("[data-pagina]")) {
    if (link.dataset.pagina === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function readSelection() {
  const retro = location.hash.match(/^#\/retro\/([0-9a-f]+)$/);
  pendingRef = retro ? retro[1] : null;
  const match = location.hash.match(/^#\/tarefa\/([^/]+)\/([^/]+)$/);
  selected = match ? { project: decodeURIComponent(match[1]), key: decodeURIComponent(match[2]) } : null;
  const page = location.hash.match(/^#\/(inicio|tarefas|fonte|repositorios|projetos|configuracoes)$/)?.[1];
  if (page) detailReturn = page === "inicio" ? "inicio" : "tarefas";
  showPage(selected ? detailReturn : pendingRef ? "tarefas" : page);
  syncSheet();
}

/* O detalhe abre como folha sobre o quadro, com origem no cartão clicado; fechar devolve o foco a ele. */
let sheetOrigin = null;
function syncSheet() {
  const gaveta = $("gaveta");
  if (selected && !gaveta.open) {
    const card = document.activeElement?.closest?.(".cartao");
    if (card) {
      const box = card.getBoundingClientRect();
      gaveta.style.setProperty("--origem-x", `${box.left + box.width / 2}px`);
      gaveta.style.setProperty("--origem-y", `${box.top + box.height / 2}px`);
      sheetOrigin = card;
    }
    gaveta.showModal();
  } else if (!selected && gaveta.open) {
    gaveta.close();
  }
}
$("gaveta").addEventListener("close", () => {
  if (selected) location.hash = "#/tarefas";
  sheetOrigin?.focus?.({ preventScroll: true });
  sheetOrigin = null;
});

async function refreshDetail() {
  if (!selected) {
    $("detalhe").hidden = true;
    $("detalhe-vazio").hidden = false;
    return;
  }
  await refreshSelectedDetail(
    selected,
    () => selected,
    getTask,
    renderDetail,
    (err) => {
      $("detalhe").hidden = true;
      showError(err);
    },
  );
}

async function refresh() {
  try {
    const [list, daemon] = await Promise.all([getTasks(), getDaemon()]);
    tasks = list;
    daemonPaused = daemon.paused;
    renderTasks();
    renderDaemon();
    if (pendingRef) {
      const task = taskByRef(tasks, pendingRef);
      pendingRef = null;
      if (task) location.replace(`#/tarefa/${encodeURIComponent(task.project)}/${encodeURIComponent(task.key)}`);
      else showError(new Error("Nenhuma tarefa com esse id de retrô."));
    }
  } catch (err) {
    showError(err);
  }
  await refreshDetail();
}

async function refreshQueue() {
  const list = $("elegiveis");
  const empty = $("elegiveis-vazio");
  const button = $("atualizar-elegiveis");
  // Carregando: a própria caixa vira o estado de espera (mesma altura), e o botão clicado fica desabilitado.
  list.replaceChildren();
  empty.hidden = false;
  empty.classList.add("carregando");
  $("elegiveis-carregando").hidden = false;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const cards = await getQueue();
    list.replaceChildren(
      ...cards.map((c) => el("li", {}, el("strong", { text: c.key }), ` ${c.title} (${c.status}, ${c.project})`)),
    );
    // Sem cards, o estado vazio explica o que fazer em vez de deixar a área em branco.
    empty.hidden = cards.length > 0;
  } catch (err) {
    empty.hidden = false;
    showError(err);
  } finally {
    empty.classList.remove("carregando");
    $("elegiveis-carregando").hidden = true;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

/** Junta as rajadas de eventos numa atualização só. */
let pending;
function scheduleRefresh() {
  clearTimeout(pending);
  pending = setTimeout(refresh, 150);
}

function connect() {
  const status = $("conexao");
  const stream = eventStream();
  stream.addEventListener("open", () => {
    status.textContent = "ao vivo";
    status.className = "selo ok";
    scheduleRefresh();
  });
  stream.addEventListener("message", scheduleRefresh);
  stream.addEventListener("error", () => {
    status.textContent = "desconectado; tentando de novo…";
    status.className = "selo alerta";
  });
}

/** Desplugue pendente de confirmação: repositório e Tarefas que estão em execução nele. */
let desplugePendente = null;

/** Texto de cada estado de etapa do fluxo do GitHub App. */
const rotuloEtapa = { feito: "feito", pendente: "pendente", desconhecido: "não dá para saber" };

/** Painel do GitHub App em Configurações: receptor, App, instalações e cobertura dos repositórios (só leitura). */
async function loadGithubApp() {
  const status = $("github-app-status");
  try {
    const painel = await getGithubApp();
    $("github-app-lista").replaceChildren(
      ...linhasGithubApp(painel).map((linha) =>
        el(
          "li",
          { className: `linha-app linha-${linha.tom}` },
          el("strong", { text: linha.rotulo }),
          el("span", { text: linha.valor }),
        ),
      ),
    );
    const etapas = etapasGithubApp(painel);
    $("github-app-progresso").textContent = progressoGithubApp(etapas);
    $("github-app-fluxo").replaceChildren(
      ...etapas.map((etapa) =>
        el(
          "li",
          { className: `etapa-app etapa-${etapa.estado}`, attrs: { "data-estado": etapa.estado } },
          el("span", {
            className: "etapa-marca",
            attrs: { "aria-hidden": "true" },
            text: etapa.estado === "feito" ? "✓" : "",
          }),
          el(
            "div",
            { className: "etapa-texto" },
            el("strong", { text: etapa.titulo }),
            el("span", { text: etapa.descricao }),
          ),
          el("em", { text: rotuloEtapa[etapa.estado] }),
          etapa.acao
            ? el("a", {
                className: "secundario etapa-acao",
                text: etapa.acao.rotulo,
                attrs: { href: etapa.acao.url, target: "_blank", rel: "noopener" },
              })
            : "",
        ),
      ),
    );
    const alerta = alertaGithubApp(painel);
    $("github-app-alerta").textContent = alerta ?? "";
    $("github-app-alerta").hidden = alerta === undefined;
    status.textContent = "";
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
  }
}

/** Catálogo da página Repositórios: o último retorno da API, para a busca filtrar sem nova consulta. */
let catalogoGithub = { configurado: true, repos: [] };
let atualizacaoCatalogo = null;

/** Consulta o catálogo do App e redesenha a lista. Enquanto houver importação, consulta de novo. */
async function loadCatalogoGithub() {
  const status = $("repos-gh-status");
  try {
    catalogoGithub = await getGithubRepos();
    status.textContent = "";
    $("repos-gh-consulta").textContent = catalogoGithub.consultadoEm
      ? new Date(catalogoGithub.consultadoEm).toLocaleString("pt-BR")
      : "—";
    const mensagem = mensagemCatalogo(catalogoGithub);
    $("repos-gh-mensagem").textContent = mensagem;
    $("repos-gh-mensagem").hidden = mensagem === "";
    renderCatalogoGithub();
    if (temImportacaoEmAndamento(catalogoGithub.repos)) {
      pararAtualizacaoCatalogo();
      atualizacaoCatalogo = setTimeout(loadCatalogoGithub, 2000);
    }
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
  }
}

function pararAtualizacaoCatalogo() {
  clearTimeout(atualizacaoCatalogo);
  atualizacaoCatalogo = null;
}

function renderCatalogoGithub() {
  const termo = $("repos-gh-busca").value;
  const repos = filtrarCatalogo(catalogoGithub.repos, termo);
  const lista = $("repos-gh-lista");
  lista.replaceChildren(...repos.map((repo) => linhaCatalogoGithub(repo)));
  $("repos-gh-vazio").hidden = repos.length > 0 || !catalogoGithub.configurado || catalogoGithub.erro !== undefined;
}

function linhaCatalogoGithub(repo) {
  const estado = estadoImportacao(repo);
  let acao = "";
  let formulario = "";
  if (estado.criarProjeto) {
    formulario = formularioProjetoGithub(repo);
    acao = el("button", {
      type: "button",
      className: "primario",
      text: estado.rotuloBotao,
      attrs: { "aria-label": `${estado.rotuloBotao} para ${repo.nome}`, "aria-expanded": "false" },
      onClick: (ev) => alternarFormulario(ev.currentTarget, formulario),
    });
  } else if (estado.rotuloBotao) {
    acao = el("button", {
      type: "button",
      className: "primario",
      text: estado.rotuloBotao,
      attrs: {
        "aria-label": `${estado.rotuloBotao} de ${repo.nome}`,
        ...(estado.podeImportar ? {} : { disabled: "" }),
      },
      onClick: () => importarGithub(repo),
    });
  }
  return el(
    "li",
    { className: `repo-gh linha-${estado.tom}`, attrs: { "data-estado": estado.rotulo } },
    el(
      "div",
      { className: "repo-gh-cabeca" },
      el("strong", { text: repo.nome }),
      el("span", { className: "selo", text: visibilidade(repo) }),
      el("span", { className: "selo", text: estado.rotulo }),
    ),
    el("p", {
      className: "ajuda",
      text: `${repo.plugado ? `Projeto ${repo.plugado.projeto}` : "Sem projeto configurado"} · ${textoImportacao(repo.importacao)}`,
    }),
    estado.ajuda ? el("p", { className: "ajuda", text: estado.ajuda }) : "",
    acao,
    formulario,
  );
}

function alternarFormulario(botao, formulario) {
  formulario.hidden = !formulario.hidden;
  botao.setAttribute("aria-expanded", String(!formulario.hidden));
  if (!formulario.hidden) formulario.querySelector("input")?.focus();
}

/** Esquemas das Fontes (Jira, GitHub Issues, GitLab Issues), lidos uma vez para montar o formulário de criação. */
let esquemasFontes = null;
async function esquemasDasFontes() {
  esquemasFontes ??= await getIntegracoesFontes();
  return esquemasFontes;
}

/**
 * Formulário para criar o projeto de um repositório (ADR-0016, ADR-0022). A Fonte é escolhida, sem valor fixo; a de
 * GitHub Issues do próprio repositório vem sugerida. Horário comercial é o padrão, e o ensaio começa marcado. O comando
 * de teste é obrigatório. O servidor confere o resto e responde o que falta no projeto.
 */
function formularioProjetoGithub(repo) {
  const sugestao = sugerirProjeto(repo.nome);
  const status = el("p", { className: "ajuda", attrs: { role: "status" } });
  const tipoSel = el("select", { attrs: { name: "tipo", "aria-label": "Fonte de demandas" } });
  const camposBox = el("div", { className: "campos-fonte" });
  const poSel = seletorDePessoas("po", "PO (pessoa da Fonte)");
  const techSel = seletorDePessoas("techLead", "Tech lead (pessoa da Fonte)");
  let esquemas = [];
  let credenciais = [];

  /** Desenha os campos da Fonte escolhida; no GitHub Issues, o prefixo e o dono vêm sugeridos. */
  const desenharCampos = () => {
    const tipo = tipoSel.value;
    const esquema = esquemas.find((e) => e.tipo === tipo);
    // A lista de pessoas é da Fonte escolhida: trocar a Fonte a descarta.
    preencherSeletorDePessoas(poSel, []);
    preencherSeletorDePessoas(techSel, []);
    camposBox.replaceChildren(
      ...camposDaFonteNaCriacao(tipo, esquema?.campos ?? []).map((c) => {
        // Credencial escolhida pelo nome no cofre (ticket 03): o projeto guarda só o nome.
        if (c.tipo === "segredo")
          return el(
            "label",
            { className: "campo" },
            el("span", { text: c.rotulo }),
            el(
              "select",
              { attrs: { name: `f_${c.campo}`, "aria-label": c.rotulo } },
              opcoesDeCredenciais(credenciais).map((o) => el("option", { attrs: { value: o.valor }, text: o.texto })),
            ),
          );
        const valor =
          tipo === "github" && c.campo === "project"
            ? sugestao.prefixo
            : tipo === "github" && c.campo === "assignee"
              ? repo.dono
              : "";
        return el(
          "label",
          { className: "campo" },
          el("span", { text: c.rotulo }),
          el("input", {
            attrs: {
              name: `f_${c.campo}`,
              autocomplete: "off",
              value: valor,
              ...(c.obrigatorio ? { required: "" } : {}),
              ...(c.tipo === "lista" ? { placeholder: "separadas por vírgula" } : {}),
            },
          }),
        );
      }),
    );
  };

  const rotuloDaFonte = (e) => (e.tipo === "github" ? "GitHub Issues do mesmo repositório (sugerido)" : e.rotulo);
  Promise.all([esquemasDasFontes(), getSegredos().catch(() => [])])
    .then(([lista, cofre]) => {
      credenciais = cofre;
      // GitLab Issues não entra aqui: o projeto de GitLab é criado por caminho, no formulário próprio da página.
      esquemas = lista
        .filter((e) => e.tipo !== "gitlab")
        .sort((a, b) => (a.tipo === "github" ? -1 : b.tipo === "github" ? 1 : 0));
      tipoSel.replaceChildren(
        ...esquemas.map((e) => el("option", { attrs: { value: e.tipo }, text: rotuloDaFonte(e) })),
      );
      desenharCampos();
    })
    .catch((err) => {
      status.textContent = err instanceof Error ? err.message : String(err);
    });
  tipoSel.addEventListener("change", desenharCampos);

  const form = el(
    "form",
    { className: "form-projeto", attrs: { hidden: "" } },
    el(
      "label",
      { className: "campo" },
      el("span", { text: "Nome do projeto" }),
      el("input", {
        attrs: {
          name: "nome",
          required: "",
          value: sugestao.nome,
          pattern: "[a-z][a-z0-9\\-]{1,39}",
          autocomplete: "off",
        },
      }),
    ),
    el("label", { className: "campo" }, el("span", { text: "Fonte de demandas" }), tipoSel),
    camposBox,
    el(
      "div",
      { className: "acoes" },
      el("button", {
        type: "button",
        className: "secundario",
        text: "Buscar pessoas na Fonte",
        onClick: () => buscarPessoasDoFormulario(),
      }),
    ),
    el("label", { className: "campo" }, el("span", { text: "PO" }), poSel),
    el("label", { className: "campo" }, el("span", { text: "Tech lead" }), techSel),
    el(
      "label",
      { className: "campo" },
      el("span", { text: "Comando de teste (ex.: npm test)" }),
      el("input", { attrs: { name: "comandoTeste", required: "", autocomplete: "off" } }),
    ),
    el(
      "label",
      { className: "campo" },
      el("span", { text: "Horário de atividade" }),
      el(
        "select",
        { attrs: { name: "horario" } },
        el("option", { attrs: { value: "business-hours" }, text: "Horário comercial (padrão)" }),
        el("option", { attrs: { value: "always" }, text: "Sempre ativo" }),
      ),
    ),
    el(
      "label",
      { className: "ajuda" },
      el("input", { attrs: { type: "checkbox", name: "ensaio", checked: "" } }),
      " Ensaio: a fábrica não escreve na Fonte nem no GitHub até você desligar",
    ),
    el(
      "div",
      { className: "acoes" },
      el("button", { type: "submit", className: "primario", text: "Criar projeto" }),
      el("button", {
        type: "button",
        className: "secundario",
        text: "Cancelar",
        onClick: () => {
          form.hidden = true;
        },
      }),
    ),
    status,
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const dados = new FormData(form);
    const tipo = tipoSel.value;
    const esquema = esquemas.find((e) => e.tipo === tipo);
    const valores = Object.fromEntries(
      (esquema?.campos ?? []).map((c) => [c.campo, String(dados.get(`f_${c.campo}`) ?? "")]),
    );
    status.textContent = "Criando o projeto…";
    try {
      const criado = await criarProjetoGithub({
        repoId: repo.id,
        nome: String(dados.get("nome") ?? "").trim(),
        fonte: fonteDoFormulario(tipo, camposDaFonteNaCriacao(tipo, esquema?.campos ?? []), valores),
        horario: String(dados.get("horario") ?? "business-hours"),
        ensaio: dados.get("ensaio") === "on",
        comandoTeste: comandoDoTexto(dados.get("comandoTeste")),
        pessoas: pessoasDoFormulario(String(dados.get("po") ?? ""), String(dados.get("techLead") ?? "")),
      });
      $("repos-gh-status").textContent = mensagemCriacao(criado);
      await loadCatalogoGithub();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  });
  /** Consulta as pessoas da Fonte escolhida no formulário e preenche PO e tech lead. Só lê: nada é gravado. */
  async function buscarPessoasDoFormulario() {
    const tipo = tipoSel.value;
    const dados = new FormData(form);
    const esquema = esquemas.find((e) => e.tipo === tipo);
    const valores = Object.fromEntries(
      (esquema?.campos ?? []).map((c) => [c.campo, String(dados.get(`f_${c.campo}`) ?? "")]),
    );
    const fonte = fonteDoFormulario(tipo, camposDaFonteNaCriacao(tipo, esquema?.campos ?? []), valores);
    const consulta =
      tipo === "github"
        ? { tipo: "github", repoId: repo.id }
        : {
            tipo: "jira",
            baseUrl: fonte.baseUrl ?? "",
            email: fonte.email ?? "",
            credencial: fonte.credential ?? "",
            projeto: fonte.project ?? "",
          };
    status.textContent = "Consultando pessoas na Fonte…";
    try {
      const pessoas = await listarPessoasDaFonte(consulta);
      preencherSeletorDePessoas(poSel, pessoas);
      preencherSeletorDePessoas(techSel, pessoas);
      status.textContent =
        pessoas.length === 0 ? "A Fonte não tem pessoas para este projeto." : `${pessoas.length} pessoa(s) na Fonte.`;
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  }
  return form;
}

/** Seletor de PO ou tech lead, começando com "sem pessoa"; a lista vem da Fonte depois (ticket 06). */
function seletorDePessoas(name, rotulo) {
  return el("select", { attrs: { name, "aria-label": rotulo } }, ...opcoesDePessoas([]).map(opcaoDoSeletor));
}

/** Troca as opções de um seletor de pessoas pela lista da Fonte. */
function preencherSeletorDePessoas(seletor, pessoas) {
  seletor.replaceChildren(...opcoesDePessoas(pessoas).map(opcaoDoSeletor));
}

const opcaoDoSeletor = (o) => el("option", { attrs: { value: o.valor }, text: o.texto });

/** Preenche o seletor de credenciais do formulário GitLab com o cofre: o projeto guarda só o nome (ticket 03). */
async function carregarCredenciaisGitlab() {
  const seletor = $("repos-gl-credencial");
  const status = $("repos-gl-status");
  try {
    const cofre = await getSegredos();
    const atual = seletor.value;
    seletor.replaceChildren(...cofre.map((c) => el("option", { attrs: { value: c.nome }, text: c.nome })));
    if (cofre.some((c) => c.nome === atual)) seletor.value = atual;
    status.textContent = cofre.length === 0 ? "Cadastre o token do GitLab no cofre de credenciais primeiro." : "";
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
  }
}

/** Consulta as pessoas do projeto GitLab informado no formulário e preenche PO e tech lead. Só lê: nada é gravado. */
async function buscarPessoasGitlab() {
  const status = $("repos-gl-pessoas-status");
  const dados = new FormData($("repos-gl-form"));
  const campo = (nome) => String(dados.get(nome) ?? "").trim();
  status.textContent = "Consultando pessoas na Fonte…";
  try {
    const pessoas = await listarPessoasDaFonte({
      tipo: "gitlab",
      caminho: campo("caminho"),
      servidor: campo("servidor"),
      credencial: campo("credencial"),
    });
    preencherSeletorDePessoas($("repos-gl-po"), pessoas);
    preencherSeletorDePessoas($("repos-gl-tech-lead"), pessoas);
    status.textContent =
      pessoas.length === 0 ? "A Fonte não tem pessoas para este projeto." : `${pessoas.length} pessoa(s) na Fonte.`;
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
  }
}

/** Cria o projeto com o repositório GitLab informado por caminho; o servidor confere o caminho com o token antes. */
async function criarProjetoGitlabPeloFormulario(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const status = $("repos-gl-status");
  const dados = new FormData(form);
  const campo = (nome) => String(dados.get(nome) ?? "");
  status.textContent = "Conferindo o repositório no GitLab…";
  try {
    const criado = await criarProjetoGitlab(
      corpoProjetoGitlab({
        nome: campo("nome"),
        servidor: campo("servidor"),
        caminho: campo("caminho"),
        credencial: campo("credencial"),
        prefixo: campo("prefixo"),
        dono: campo("dono"),
        comandoTeste: campo("comandoTeste"),
        horario: campo("horario") || "business-hours",
        ensaio: dados.get("ensaio") === "on",
        pessoas: pessoasDoFormulario(campo("po"), campo("techLead")),
      }),
    );
    form.reset();
    await carregarCredenciaisGitlab();
    status.textContent = mensagemCriacao(criado);
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
  }
}

/** Pede a importação; a fila roda em segundo plano, e o redesenho acompanha pelo polling. */
async function importarGithub(repo) {
  const status = $("repos-gh-status");
  try {
    await importarRepoGithub(repo.id);
    status.textContent = `Importação de ${repo.nome} na fila.`;
    await loadCatalogoGithub();
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
  }
}

/** Lista os repositórios monitorados na seção de Configurações. */
async function loadRepos() {
  // Só escreve no status em caso de erro: a mensagem de uma ação (plugar, desplugar) não pode ser apagada aqui.
  try {
    renderRepos(linhasRepositorios(await getRepos()));
  } catch (err) {
    $("repos-status").textContent = err instanceof Error ? err.message : String(err);
  }
}

function renderRepos(linhas) {
  const lista = $("repos-lista");
  lista.replaceChildren();
  $("repos-vazio").hidden = linhas.length > 0;
  for (const linha of linhas) {
    const desplugar = linha.acao === "desplugar";
    const rotulo = desplugar ? "Desplugar" : "Plugar";
    lista.append(
      el(
        "li",
        {},
        el("strong", { text: linha.repositorio }),
        " ",
        el("span", { className: "selo", text: linha.estado }),
        el("p", {
          className: "ajuda",
          text: `${linha.projeto} · ${linha.origem}${linha.motivo ? ` · ${linha.motivo}` : ""}`,
        }),
        el("button", {
          type: "button",
          className: desplugar ? "secundario" : "primario",
          text: rotulo,
          attrs: { "aria-label": `${rotulo} ${linha.repositorio}` },
          onClick: () => (desplugar ? desplugarRepo(linha.repositorio, false) : plugarRepo(linha.repositorio)),
        }),
      ),
    );
  }
}

async function plugarRepo(repo) {
  const status = $("repos-status");
  try {
    await plugRepo(repo);
    status.textContent = `${repo} plugado: a próxima busca enfileira os cards dele.`;
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
  }
  await loadRepos();
}

/**
 * Desplugue. Sem `force`, uma Tarefa em execução devolve 409 com a lista: a tela pede confirmação antes de cancelá-la.
 */
async function desplugarRepo(repo, force) {
  const status = $("repos-status");
  try {
    await unplugRepo(repo, force);
    esconderConfirmacao();
    status.textContent = `${repo} desplugado. As Tarefas não iniciadas dele foram canceladas.`;
  } catch (err) {
    const ativas = err instanceof Error ? err.payload?.tarefasAtivas : undefined;
    if (ativas?.length && !force) {
      desplugePendente = repo;
      $("repos-confirmacao-texto").textContent = mensagemTarefasAtivas(ativas);
      $("repos-confirmacao").hidden = false;
      $("repos-confirmar").focus();
    } else {
      esconderConfirmacao();
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  }
  await loadRepos();
}

function esconderConfirmacao() {
  desplugePendente = null;
  $("repos-confirmacao").hidden = true;
  $("repos-confirmacao-texto").textContent = "";
}

$("repos-manter").addEventListener("click", () => {
  esconderConfirmacao();
  $("repos-status").textContent = "Repositório mantido conectado; nada foi alterado.";
});
$("repos-confirmar").addEventListener("click", () => {
  if (desplugePendente) desplugarRepo(desplugePendente, true);
});

/** Carrega o repositório atual no formulário inline de Configurações, ao abrir a página. */
async function loadRetroSettings() {
  const input = $("repositorio-retros");
  const status = $("retros-config-status");
  const save = $("salvar-retros");
  status.textContent = "Carregando configuração…";
  save.disabled = true;
  input.disabled = true;
  try {
    const settings = await getRetroSettings();
    input.value = settings.repo ?? "";
    input.disabled = !settings.available;
    status.textContent = settings.available ? "" : "Adaptador de publicação indisponível neste daemon.";
    save.disabled = !settings.available;
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
  }
}
$("form-retros").addEventListener("submit", async (event) => {
  event.preventDefault();
  const save = $("salvar-retros");
  save.disabled = true;
  try {
    const settings = await saveRetroSettings($("repositorio-retros").value.trim());
    $("repositorio-retros").value = settings.repo;
    $("retros-config-status").textContent =
      "Configuração salva e aplicada. Nenhuma issue foi publicada: revise cada proposta antes de aprovar.";
  } catch (err) {
    $("retros-config-status").textContent = err instanceof Error ? err.message : String(err);
  } finally {
    save.disabled = false;
  }
});

$("busca-tarefas").addEventListener("input", renderTasks);
for (const button of document.querySelectorAll("[data-filtro]"))
  button.addEventListener("click", () => {
    taskFilter = button.dataset.filtro;
    renderTasks();
  });
for (const button of document.querySelectorAll("[data-modo]"))
  button.addEventListener("click", () => {
    taskView = button.dataset.modo;
    renderTasks();
  });

$("alternar-daemon").addEventListener("click", () => run(daemonPaused ? resumeDaemon : pauseDaemon));
$("buscar").addEventListener("click", () => run(pollSource));
$("repos-gl-form").addEventListener("submit", criarProjetoGitlabPeloFormulario);
$("repos-gl-buscar-pessoas").addEventListener("click", buscarPessoasGitlab);
$("atualizar-elegiveis").addEventListener("click", refreshQueue);
$("fechar-detalhe").addEventListener("click", () => {
  location.hash = `#/${detailReturn}`;
});
window.addEventListener("hashchange", () => {
  readSelection();
  if (pendingRef) {
    refresh();
    return;
  }
  renderTasks();
  refreshDetail();
});

readSelection();
refresh();
connect();
