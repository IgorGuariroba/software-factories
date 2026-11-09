import { formatCommit } from "./view.js";

/** Progresso comprovado por commits, não uma estimativa de execução ou aprovação.
 * @param {{tickets: {titulo: string, aceite: string}[], implementation?: {commits: {ticket: number, phase: string, sha: string}[], verifiedTickets?: {ticket: number, sha: string}[]} | null}} task
 */
export function implementationSummary(task) {
  const commits = task.implementation?.commits ?? [];
  const tickets = task.tickets.map((ticket, index) => {
    const records = commits.filter((commit) => commit.ticket === index);
    const verified = task.implementation?.verifiedTickets?.some((record) => record.ticket === index);
    const green = records.some((commit) => commit.phase === "implementacao");
    const red = records.some((commit) => commit.phase === "teste");
    return {
      ...ticket,
      number: index + 1,
      records,
      state: green || verified ? "green" : red ? "red" : "pending",
      label: verified
        ? "Critério atendido · suíte e review independente"
        : green
          ? "GREEN registrado"
          : red
            ? "RED registrado"
            : "Aguardando",
    };
  });
  return {
    tickets,
    completed: tickets.filter((ticket) => ticket.state === "green").length,
    next: tickets.find((ticket) => ticket.state !== "green") ?? null,
  };
}

/** Aba isolada: a atualização ao vivo preserva expansões e foco da mesma Tarefa. */
export function renderImplementation(container, task, el) {
  const sameTask = container.dataset.task === task.id;
  const expanded = new Set(
    sameTask ? [...container.querySelectorAll("details[open]")].map((node) => node.dataset.section) : [],
  );
  const focused = container.contains(document.activeElement)
    ? document.activeElement.closest("details")?.dataset.section
    : null;
  const disclosure = (key, className, summary, ...children) => {
    const node = el("details", { className, attrs: { "data-section": key } }, summary, ...children);
    node.open = expanded.has(key);
    return node;
  };
  const time = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "");
  const { tickets, completed, next } = implementationSummary(task);
  const impl = task.implementation;
  const active = task.status === "ativa" && task.stage === "implementacao";
  const parts = [
    el(
      "section",
      { className: "impl-overview" },
      el(
        "div",
        { className: "impl-overview-heading" },
        el("h3", { text: "Progresso dos tickets" }),
        el("span", { className: "impl-count", text: `${completed} de ${tickets.length}` }),
      ),
      ...(tickets.length
        ? [
            el("progress", {
              attrs: {
                value: String(completed),
                max: String(tickets.length),
                "aria-label": "Tickets implementados ou verificados independentemente",
              },
            }),
          ]
        : []),
      el("p", {
        className: "impl-next",
        text: next
          ? `Próximo registro esperado: ticket ${next.number} · ${next.state === "red" ? "implementação GREEN" : "teste RED"}.`
          : tickets.length
            ? "Todos os tickets têm implementação ou verificação registrada."
            : "Os tickets aparecerão após a preparação da SPEC.",
      }),
      el("p", { className: "impl-caveat", text: "Review, CI e merge são verificados separadamente." }),
    ),
  ];
  if (!impl)
    parts.push(
      el("p", {
        className: "vazio",
        text: active
          ? "Aguardando os primeiros registros. A execução pode estar em andamento."
          : "Nenhum registro de implementação disponível para esta tarefa.",
      }),
    );
  parts.push(
    el("h3", { text: "Tickets" }),
    el(
      "div",
      { className: "impl-tickets" },
      ...tickets.map((ticket) =>
        disclosure(
          `ticket-${ticket.number}`,
          `impl-ticket ${ticket.state}`,
          el(
            "summary",
            {},
            el(
              "span",
              { className: "impl-ticket-row" },
              el("span", { className: "impl-ticket-number", text: String(ticket.number) }),
              el(
                "span",
                { className: "impl-ticket-title" },
                el("strong", { text: ticket.titulo.replace(new RegExp(`^${ticket.number}\\.\\s+`), "") }),
                el("small", { text: ticket.label }),
              ),
            ),
          ),
          el(
            "div",
            { className: "impl-ticket-body" },
            el("h4", { text: "Critério de aceite" }),
            el("p", { text: ticket.aceite }),
            el("h4", { text: "Commits registrados" }),
            ...(ticket.records.length
              ? ticket.records.map((commit) =>
                  el(
                    "p",
                    {},
                    el("code", { text: formatCommit(commit) }),
                    ...(impl?.repairs?.some((repair) => repair.sha === commit.sha)
                      ? [el("span", { className: "selo", text: "Reparo humano validado" })]
                      : []),
                  ),
                )
              : [el("p", { className: "vazio", text: "Sem commits registrados." })]),
          ),
        ),
      ),
    ),
  );
  if (impl)
    parts.push(
      disclosure(
        "branch",
        "impl-technical",
        el("summary", { text: "Branch e envio ao remoto" }),
        el("p", {}, el("code", { text: impl.branch })),
        el("p", {
          className: "vazio",
          text: `${impl.commits.length} commit(s) · ${impl.pushed ? "enviada ao remoto" : "ainda não enviada"}`,
        }),
      ),
    );
  const events = task.events
    .filter((event) => event.type === "progress" || event.type === "error")
    .slice(-8)
    .reverse();
  parts.push(
    el(
      "details",
      {
        className: "impl-history",
        attrs: { "data-section": "history", ...(expanded.has("history") ? { open: "" } : {}) },
      },
      el(
        "summary",
        {},
        el("h3", { text: "Registros recentes de execução" }),
        el("span", { className: "impl-history-hint", text: `${events.length} registros · abrir histórico` }),
        ...(events.length
          ? [el("span", { className: "impl-event-preview", text: events[0].message.split("\n")[0] })]
          : []),
      ),
      el("p", {
        className: "vazio",
        text: "Mais recentes primeiro. Abra um registro para ler o diagnóstico completo. Todos os eventos estão na aba Atividade.",
      }),
      ...events.map((event) =>
        disclosure(
          `event-${event.at}-${event.message}`,
          `impl-event${event.type === "error" ? " impl-error" : ""}`,
          el(
            "summary",
            {},
            el("time", { className: "quando", attrs: { datetime: event.at }, text: time(event.at) }),
            el("span", { className: "impl-event-preview", text: event.message.split("\n")[0] }),
          ),
          el("pre", { className: "texto", text: event.message }),
        ),
      ),
      ...(!events.length
        ? [
            el("p", {
              className: "vazio",
              text: "Ainda não há eventos de progresso. Esta visão mostra registros persistidos, não o terminal ou o raciocínio interno do modelo.",
            }),
          ]
        : []),
    ),
  );
  if (task.review)
    parts.push(
      disclosure(
        "review",
        "impl-technical",
        el("summary", { text: `Review · ${task.review.status}` }),
        el("p", {}, el("code", { text: task.review.head.slice(0, 8) })),
        el("p", { text: task.review.summary }),
      ),
    );
  if (task.publication)
    parts.push(
      el(
        "section",
        { className: "bloco-detalhe" },
        el("h3", { text: "PR/MR" }),
        el("p", { text: task.publication.status }),
        ...(task.publication.url
          ? [el("a", { text: "Abrir PR/MR", attrs: { href: task.publication.url, target: "_blank", rel: "noopener" } })]
          : []),
      ),
    );
  container.replaceChildren(...parts);
  container.dataset.task = task.id;
  if (sameTask && focused)
    [...container.querySelectorAll("details")]
      .find((node) => node.dataset.section === focused)
      ?.querySelector("summary")
      ?.focus({ preventScroll: true });
}
