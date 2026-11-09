// Único ponto em que a página fala com o daemon: tudo passa pela API local documentada em /openapi.json.

/**
 * Chama a API. O navegador manda o Origin da própria página (localhost), que é o que a API exige num POST.
 * @param {"GET" | "POST"} method
 * @param {string} path
 * @param {unknown} [body]
 */
export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    // O corpo vai junto: alguns erros trazem dados que a tela usa (ex.: as Tarefas que impedem um desplugue).
    const err = new Error(payload.error ?? `${method} ${path}: HTTP ${res.status}`);
    err.payload = payload;
    throw err;
  }
  return payload;
}

/** Stream de eventos da fábrica (SSE). O EventSource reconecta sozinho. */
export const eventStream = () => new EventSource("/events/stream");

/** Segmento de caminho de uma Tarefa (projeto ou card), escapado. */
const seg = encodeURIComponent;

export const getTasks = () => api("GET", "/tasks");
export const getTask = (project, key) => api("GET", `/tasks/${seg(project)}/${seg(key)}`);
export const getQueue = () => api("GET", "/queue");
export const getDaemon = () => api("GET", "/daemon");
export const getRetroSettings = () => api("GET", "/settings/retro");
export const saveRetroSettings = (repo) => api("POST", "/settings/retro", { repo });
export const pollSource = () => api("POST", "/poll");
export const getRepos = () => api("GET", "/repos");
export const getGithubApp = () => api("GET", "/github-app");
export const plugRepo = (repo) => api("POST", "/repos/plugar", { repo });
export const unplugRepo = (repo, force = false) => api("POST", "/repos/desplugar", { repo, force });
export const pauseDaemon = () => api("POST", "/daemon/pause");
export const resumeDaemon = () => api("POST", "/daemon/resume");
export const reorderTasks = (ids) => api("POST", "/tasks/order", { ids });
export const vetoTask = (project, key) => api("POST", `/tasks/${seg(project)}/${seg(key)}/veto`);
export const pauseTask = (project, key) => api("POST", `/tasks/${seg(project)}/${seg(key)}/pause`);
export const resumeTask = (project, key) => api("POST", `/tasks/${seg(project)}/${seg(key)}/resume`);
export const cancelTask = (project, key) => api("POST", `/tasks/${seg(project)}/${seg(key)}/cancel`);
export const getTriagePreview = (project, key) => api("GET", `/tasks/${seg(project)}/${seg(key)}/triage`);
export const decideTriage = (project, key, decision, revision) =>
  api("POST", `/tasks/${seg(project)}/${seg(key)}/triage/decide`, { decision, revision });
export const getSpecPreview = (project, key) => api("GET", `/tasks/${seg(project)}/${seg(key)}/spec`);
export const approveSpec = (project, key, revision) =>
  api("POST", `/tasks/${seg(project)}/${seg(key)}/spec/approve`, { revision });
export const getReminderPreview = (project, key, n) =>
  api("GET", `/tasks/${seg(project)}/${seg(key)}/questions/${n}/reminder`);
export const approveReminder = (project, key, n, revision) =>
  api("POST", `/tasks/${seg(project)}/${seg(key)}/questions/${n}/reminder/approve`, { revision });
export const getQuestionPreview = (project, key, n) => api("GET", `/tasks/${seg(project)}/${seg(key)}/questions/${n}`);
export const approveQuestion = (project, key, n, revision) =>
  api("POST", `/tasks/${seg(project)}/${seg(key)}/questions/${n}/approve`, { revision });
/** A classificação e a retomada pertencem à API, não ao navegador. */
export const answerQuestion = (project, key, n, answer) =>
  api("POST", `/tasks/${seg(project)}/${seg(key)}/questions/${n}/answer`, { answer });
export const getRetroPreview = (project, key, stage, n) =>
  api("GET", `/tasks/${seg(project)}/${seg(key)}/retros/${seg(stage)}/${n}`);
export const approveRetro = (project, key, stage, n, revision) =>
  api("POST", `/tasks/${seg(project)}/${seg(key)}/retros/${seg(stage)}/${n}/approve`, { revision });
