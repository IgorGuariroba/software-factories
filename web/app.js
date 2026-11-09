// Página de gestão: lê e comanda a fábrica só pela API local, e se atualiza pelo stream de eventos (SSE).
// O DOM é montado com createElement e textContent: conteúdo do card e do modelo nunca vira HTML.
import {
  answerQuestion,
  approveQuestion,
  approveReminder,
  approveRetro,
  approveSpec,
  cancelTask,
  decideTriage,
  eventStream,
  getDaemon,
  getQuestionPreview,
  getQueue,
  getReminderPreview,
  getRetroPreview,
  getRetroSettings,
  getSpecPreview,
  getTask,
  getTasks,
  getTriagePreview,
  pauseDaemon,
  pauseTask,
  pollSource,
  reorderTasks,
  resumeDaemon,
  resumeTask,
  saveRetroSettings,
  vetoTask,
} from "./api.js";
import {
  actionsFor,
  actionTab,
  activity,
  boardColumns,
  canAnswerQuestion,
  cardHint,
  detailStatusLabel,
  formatCommit,
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
  const field = el("textarea", { attrs: { rows: "3", maxlength: "20000", "aria-label": `Resposta à pergunta ${question.n}`, placeholder: "Sua resposta" } });
  field.value = answerDrafts.get(id) ?? "";
  field.addEventListener("input", () => answerDrafts.set(id, field.value));
  const button = el("button", { text: "Responder", attrs: { type: "button" } });
  button.addEventListener("click", async () => {
    const answer = field.value.trim();
    if (!answer || answer.length > 20000) return showError(new Error("A resposta deve ter entre 1 e 20000 caracteres."));
    button.disabled = true; field.disabled = true;
    try {
      await answerQuestion(task.project, task.key, question.n, answer);
      answerDrafts.delete(id); clearError(); await refresh();
    } catch (err) { showError(err); }
    finally { button.disabled = false; field.disabled = false; }
  });
  return el("div", {}, el("label", { text: "Sua resposta" }), field, button);
}
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
              onClick: openRetroSettings,
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
  retomar: { label: "Retomar", run: (t) => resumeTask(t.project, t.key) },
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
        if (action.confirm && !window.confirm(action.confirm(task))) return;
        run(() => action.run(task));
      },
    });
  });
}

function moveButton(task, delta) {
  const order = moveTask(tasks, task.id, delta);
  const label = delta < 0 ? "Subir" : "Descer";
  const button = el("button", {
    text: delta < 0 ? "↑" : "↓",
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
    el("span", { className: "titulo" }, el("span", { className: `situacao ${task.status}` }), task.title),
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

function renderTasks() {
  const visible = visibleTasks(tasks, taskFilter, $("busca-tarefas").value);
  const counts = workspaceCounts(tasks);
  for (const [key, count] of Object.entries(counts)) $(`total-${key}`).textContent = String(count);
  for (const button of document.querySelectorAll("[data-filtro]"))
    button.setAttribute("aria-pressed", String(button.dataset.filtro === taskFilter));
  for (const button of document.querySelectorAll("[data-modo]"))
    button.setAttribute("aria-pressed", String(button.dataset.modo === taskView));
  $("resultado-contagem").textContent =
    `${visible.length} de ${tasks.length} tarefas · ${taskView === "lista" ? "Pendências primeiro" : "Organizadas por etapa"}`;
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
        { className: "cartoes lista-tarefas", attrs: { "aria-label": "Lista de tarefas" } },
        ...priorityTasks(visible).map(taskCard),
      ),
    );
  const open = tasks.filter((t) => !isTerminal(t)).length;
  $("fila-contagem").textContent = `(${open} em andamento)`;
  $("fila-vazia").hidden = visible.length > 0;
}

function renderDaemon() {
  const badge = $("daemon");
  badge.textContent = daemonPaused ? "daemon: pausado" : "daemon: rodando";
  badge.className = `selo ${daemonPaused ? "alerta" : "ok"}`;
  const toggle = $("alternar-daemon");
  toggle.textContent = daemonPaused ? "Retomar daemon" : "Pausar daemon";
  toggle.disabled = false;
}

let openedTask = null;
function renderDetail(task) {
  const focused = document.activeElement;
  const editing =
    focused?.matches("textarea") && $("detalhe").contains(focused)
      ? { label: focused.getAttribute("aria-label"), start: focused.selectionStart, end: focused.selectionEnd }
      : null;
  if (openedTask !== task.id) {
    openedTask = task.id;
    $("fluxo-tarefa").open = false;
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
            text: task.status === "pausada" ? "Retomar tarefa" : "Ver próxima ação",
            attrs: { type: "button" },
            onClick: () => {
              if (task.status === "pausada") {
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
            ...(q.answer === null ? [answerQuestionControls(task, q)] : []),
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

  const impl = task.implementation;
  const implParts = [];
  const implementationActive = task.stage === "implementacao" && task.status === "ativa";
  implParts.push(
    el(
      "div",
      { className: "bloco-detalhe" },
      el("h3", { text: implementationActive ? "Implementação em andamento" : "Visão da implementação" }),
      el("p", {
        className: "vazio",
        text: implementationActive
          ? "A fábrica está trabalhando. Os registros abaixo são atualizados ao vivo conforme o progresso é salvo."
          : `${detailStatusLabel(task)} · ${stageLabel(task.stage)}`,
      }),
    ),
  );
  if (!impl)
    implParts.push(
      el("p", {
        className: "vazio",
        text: implementationActive
          ? "Aguardando os primeiros registros de branch e commits. Isso não significa que a execução está parada."
          : "Nenhum registro de implementação disponível para esta tarefa.",
      }),
    );
  else {
    const completedTickets = task.tickets.filter((_, index) =>
      impl.commits.some((commit) => commit.ticket === index && commit.phase === "implementacao"),
    ).length;
    if (task.tickets.length)
      implParts.push(
        el(
          "div",
          { className: "bloco-detalhe" },
          el("strong", { text: `${completedTickets} de ${task.tickets.length} tickets com implementação registrada` }),
          el("progress", {
            attrs: {
              value: String(completedTickets),
              max: String(task.tickets.length),
              "aria-label": "Tickets com commit de implementação",
            },
          }),
          el("p", {
            className: "vazio",
            text: "Baseado nos commits registrados. Não representa aprovação de review, CI ou merge.",
          }),
        ),
      );
    implParts.push(
      el(
        "p",
        {},
        "Branch ",
        el("code", { text: impl.branch }),
        ` · ${impl.commits.length} commit(s) · ${impl.pushed ? "enviada ao remoto" : "ainda não enviada"}`,
      ),
    );
    task.tickets.forEach((ticket, i) => {
      const commits = impl.commits.filter((c) => c.ticket === i);
      const phase = (name) => commits.find((c) => c.phase === name);
      const done = phase("implementacao")
        ? "GREEN · implementação registrada"
        : phase("teste")
          ? "RED · teste registrado"
          : "Sem commits registrados";
      implParts.push(
        el(
          "div",
          { className: "ticket" },
          el("h4", { text: `Ticket ${i + 1}: ${ticket.titulo} — ${done}` }),
          el("p", { className: "vazio", text: ticket.aceite }),
          ...commits.map((c) =>
            el(
              "p",
              {},
              el("code", { text: formatCommit(c) }),
              ...(impl.repairs?.some((repair) => repair.sha === c.sha)
                ? [el("span", { className: "selo", text: "Reparo humano validado" })]
                : []),
            ),
          ),
        ),
      );
    });
  }
  if (!impl && task.tickets.length)
    implParts.push(
      el("h3", { text: "Tickets planejados" }),
      ...task.tickets.map((ticket, i) =>
        el(
          "div",
          { className: "ticket" },
          el("h4", { text: `Ticket ${i + 1}: ${ticket.titulo}` }),
          el("p", { className: "vazio", text: "Sem commits registrados" }),
          el("p", { text: ticket.aceite }),
        ),
      ),
    );
  const implementationEvents = task.events
    .filter((event) => event.type === "progress" || event.type === "error")
    .slice(-8)
    .reverse();
  implParts.push(
    el("h3", { text: "Registros recentes de execução" }),
    ...(implementationEvents.length
      ? implementationEvents.map((event) =>
          el(
            "div",
            { className: "ticket" },
            el("span", { className: "quando", text: formatTime(event.at) }),
            el("p", { text: event.message }),
          ),
        )
      : [
          el("p", {
            className: "vazio",
            text: "Ainda não há eventos de progresso. Esta visão mostra registros persistidos, não o terminal ou o raciocínio interno do modelo.",
          }),
        ]),
  );
  if (task.review)
    implParts.push(
      el("h3", { text: "Review" }),
      el("p", {}, el("strong", { text: task.review.status }), ` · HEAD ${task.review.head.slice(0, 8)}`),
      el("p", { text: task.review.summary }),
    );
  if (task.publication)
    implParts.push(
      el("h3", { text: "PR/MR" }),
      el(
        "p",
        {},
        `${task.publication.status} `,
        ...(task.publication.url
          ? [
              el("a", {
                text: task.publication.url,
                attrs: { href: task.publication.url, target: "_blank", rel: "noopener" },
              }),
            ]
          : []),
      ),
    );
  $("detalhe-implementacao").replaceChildren(...implParts);

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

function readSelection() {
  const retro = location.hash.match(/^#\/retro\/([0-9a-f]+)$/);
  pendingRef = retro ? retro[1] : null;
  const match = location.hash.match(/^#\/tarefa\/([^/]+)\/([^/]+)$/);
  selected = match ? { project: decodeURIComponent(match[1]), key: decodeURIComponent(match[2]) } : null;
}

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
  list.replaceChildren(el("li", { className: "vazio", text: "Consultando…" }));
  try {
    const cards = await getQueue();
    list.replaceChildren(
      ...(cards.length === 0
        ? [el("li", { className: "vazio", text: "Nenhum card elegível." })]
        : cards.map((c) => el("li", {}, el("strong", { text: c.key }), ` ${c.title} (${c.status}, ${c.project})`))),
    );
  } catch (err) {
    list.replaceChildren();
    showError(err);
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

async function openRetroSettings() {
  const dialog = $("configuracao-retros");
  const status = $("retros-config-status");
  const save = $("salvar-retros");
  status.textContent = "Carregando configuração…";
  save.disabled = true;
  $("repositorio-retros").disabled = true;
  dialog.showModal();
  try {
    const settings = await getRetroSettings();
    $("repositorio-retros").value = settings.repo ?? "";
    $("repositorio-retros").disabled = !settings.available;
    status.textContent = settings.available ? "" : "Adaptador de publicação indisponível neste daemon.";
    save.disabled = !settings.available;
    $("repositorio-retros").focus();
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
  }
}
$("configurar-retros").addEventListener("click", openRetroSettings);
$("fechar-configuracao-retros").addEventListener("click", () => $("configuracao-retros").close());
$("form-retros").addEventListener("submit", async (event) => {
  event.preventDefault();
  const save = $("salvar-retros");
  save.disabled = true;
  try {
    const settings = await saveRetroSettings($("repositorio-retros").value.trim());
    $("repositorio-retros").value = settings.repo;
    $("retros-config-status").textContent =
      "Configuração salva e aplicada. Feche esta janela e revise novamente a publicação. Nenhuma issue foi publicada.";
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
$("atualizar-elegiveis").addEventListener("click", refreshQueue);
$("fechar-detalhe").addEventListener("click", () => {
  location.hash = "";
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
