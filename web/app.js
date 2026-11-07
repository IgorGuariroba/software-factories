// Página de gestão: lê e comanda a fábrica só pela API local, e se atualiza pelo stream de eventos (SSE).
// O DOM é montado com createElement e textContent: conteúdo do card e do modelo nunca vira HTML.
import {
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
  vetoTask,
} from "./api.js";
import {
  actionsFor,
  describeEvent,
  detailStatusLabel,
  formatCommit,
  isTerminal,
  moveTask,
  proposalLabel,
  refreshSelectedDetail,
  retroStageLabel,
  retroStatusLabel,
  stageLabel,
  statusLabel,
  taskByRef,
  writeSituation,
} from "./view.js";

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
        showError(err);
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
  button.disabled = order === null;
  return button;
}

function taskLink(task) {
  return el("a", {
    text: task.key,
    attrs: { href: `#/tarefa/${encodeURIComponent(task.project)}/${encodeURIComponent(task.key)}` },
  });
}

function renderTasks() {
  const open = tasks.filter((t) => !isTerminal(t));
  const closed = tasks.filter(isTerminal);
  const isSelected = (t) => selected && t.project === selected.project && t.key === selected.key;

  $("fila")
    .querySelector("tbody")
    .replaceChildren(
      ...open.map((t, i) =>
        el(
          "tr",
          { className: isSelected(t) ? "selecionada" : "" },
          el("td", { text: String(i + 1) }),
          el("td", {}, taskLink(t)),
          el("td", { text: t.title }),
          el("td", { text: statusLabel(t.status) }),
          el("td", { text: stageLabel(t.stage) }),
          el("td", {}, el("div", { className: "acoes" }, moveButton(t, -1), moveButton(t, 1), ...actionButtons(t))),
        ),
      ),
    );
  $("fila-vazia").hidden = open.length > 0;
  $("fila").hidden = open.length === 0;

  $("encerradas")
    .querySelector("tbody")
    .replaceChildren(
      ...closed.map((t) =>
        el(
          "tr",
          { className: isSelected(t) ? "selecionada" : "" },
          el("td", {}, taskLink(t)),
          el("td", { text: t.title }),
          el("td", { text: statusLabel(t.status) }),
          el("td", { text: stageLabel(t.stage) }),
          el("td", { text: t.reason ?? "" }),
        ),
      ),
    );
  $("encerradas-vazia").hidden = closed.length > 0;
  $("encerradas").hidden = closed.length === 0;
}

function renderDaemon() {
  const badge = $("daemon");
  badge.textContent = daemonPaused ? "daemon: pausado" : "daemon: rodando";
  badge.className = `selo ${daemonPaused ? "alerta" : "ok"}`;
  const toggle = $("alternar-daemon");
  toggle.textContent = daemonPaused ? "Retomar daemon" : "Pausar daemon";
  toggle.disabled = false;
}

function renderDetail(task) {
  $("titulo-detalhe").textContent = `${task.key}: ${task.title}`;

  const fields = [
    ["Projeto", task.project],
    ["Status", detailStatusLabel(task)],
    ["Etapa", stageLabel(task.stage)],
    ["Tentativas", String(task.attempts)],
  ];
  if (task.pauseRequested && task.status !== "pausada") fields.push(["Pausa", "pedida; para no próximo passo"]);
  if (task.vetoUntil) fields.push(["Prazo de veto", formatTime(task.vetoUntil)]);
  if (task.reason) fields.push(["Motivo", task.reason]);
  $("detalhe-estado").replaceChildren(...fields.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })]));
  $("detalhe-acoes").replaceChildren(...actionButtons(task));

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
                    ? "(publicação não confirmada; verifique o Jira)"
                    : q.answer === null
                      ? "(pendente)"
                      : `Resposta: ${q.answer}`,
            }),
            ...(q.publication === "draft" ? [reviewQuestionButton(task, q)] : []),
            ...(q.reminder === "draft" && q.answer === null ? [reviewReminderButton(task, q)] : []),
            ...(q.reminder === "sending" ? [el("p", { text: "Lembrete não confirmado; verifique o Jira." })] : []),
            ...(q.teamsNotice === "uncertain" || q.teamsNotice === "attempted"
              ? [el("p", { text: "Aviso Teams não confirmado; verifique o chat antes de reenviar." })]
              : []),
          ),
        )),
  );

  $("detalhe-spec").textContent = task.spec ?? "Ainda não entregue.";
  $("detalhe-triagem").replaceChildren(
    ...(task.triage
      ? [
          el("p", { text: `${task.triage.verdict}: ${task.triage.reason}` }),
          ...(task.triage.review === "draft" ? [reviewTriageButton(task)] : []),
        ]
      : [el("p", { text: "Sem triagem (só repositório monitorado)." })]),
  );
  $("detalhe-spec-revisao").replaceChildren(
    ...(task.specReview === "draft"
      ? [el("p", { text: "SPEC e Tickets aguardam revisão." }), reviewSpecButton(task)]
      : []),
  );
  $("detalhe-tickets").replaceChildren(
    ...task.tickets.map((t) => el("li", {}, el("strong", { text: t.titulo }), `: ${t.aceite}`)),
  );

  const impl = task.implementation;
  $("detalhe-implementacao").replaceChildren(
    impl
      ? el(
          "p",
          {},
          `Branch ${impl.branch}, ${impl.commits.length} commit(s), ${impl.pushed ? "com push" : "sem push"}. `,
          ...impl.commits.map((c) => el("code", { text: formatCommit(c) })),
        )
      : el("p", { className: "vazio", text: "Ainda não começou." }),
  );

  $("detalhe-retros").replaceChildren(
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
    ...task.events.map((e) =>
      el("li", {}, el("span", { className: "quando", text: formatTime(e.at) }), describeEvent(e)),
    ),
  );
  $("detalhe").hidden = false;
}

function readSelection() {
  const retro = location.hash.match(/^#\/retro\/([0-9a-f]+)$/);
  pendingRef = retro ? retro[1] : null;
  const match = location.hash.match(/^#\/tarefa\/([^/]+)\/([^/]+)$/);
  selected = match ? { project: decodeURIComponent(match[1]), key: decodeURIComponent(match[2]) } : null;
}

async function refreshDetail() {
  if (!selected) {
    $("detalhe").hidden = true;
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
