import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { ChangeRequest, RequestDraft } from "./code-host.js";
import { isAutomationText } from "./effect-writer.js";
import { git } from "./git.js";

const pexec = promisify(execFile);
const Note = z.object({
  id: z.number(),
  body: z.string().nullable().default(""),
  user: z.object({ login: z.string() }).optional(),
  author: z.object({ username: z.string() }).optional(),
  system: z.boolean().optional(),
});
const GhRequest = z.object({
  number: z.number(),
  html_url: z.string().url(),
  state: z.string(),
  merged: z.boolean().optional(),
  head: z.object({ sha: z.string(), ref: z.string() }),
  base: z.object({ ref: z.string() }),
  mergeable: z.boolean().nullable().optional(),
});
const GlRequest = z.object({
  iid: z.number(),
  web_url: z.string().url(),
  state: z.string(),
  sha: z.string(),
  source_branch: z.string(),
  target_branch: z.string(),
  has_conflicts: z.boolean().optional(),
  head_pipeline: z.object({ sha: z.string(), status: z.string() }).nullable().optional(),
});

async function target(cwd: string) {
  const remote = (await git(cwd, ["remote", "get-url", "origin"])).trim();
  const scp = /^git@([^:]+):(.+)$/.exec(remote);
  const url = scp ? undefined : URL.canParse(remote) ? new URL(remote) : undefined;
  const host = scp?.[1] ?? url?.hostname;
  const repo = (scp?.[2] ?? url?.pathname ?? "").replace(/^\//, "").replace(/\.git$/, "");
  if (!host || !/^[\w.-]+$/.test(host) || !/^[\w./-]+\/[\w.-]+$/.test(repo) || url?.password)
    throw new Error("remoto origin não identifica repositório HTTPS/SSH suportado para PR/MR");
  const github = host === "github.com" || host.includes("github.");
  const bin = github ? "gh" : "glab";
  const root = github ? `repos/${repo}` : `projects/${encodeURIComponent(repo)}`;
  const api = async (endpoint: string, fields?: Record<string, string>): Promise<unknown> => {
    const args = ["api", "--hostname", host, endpoint];
    if (fields) {
      args.push("--method", "POST");
      for (const [key, value] of Object.entries(fields)) args.push("--raw-field", `${key}=${value}`);
    }
    const { stdout } = await pexec(bin, args, { cwd, timeout: 30_000, maxBuffer: 4_000_000 });
    return JSON.parse(stdout);
  };
  const pages = async (path: string, field?: string): Promise<unknown[]> => {
    const all: unknown[] = [];
    for (let page = 1; page <= 100; page++) {
      const value = await api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      const rows = z.array(z.unknown()).parse(field ? (value as Record<string, unknown>)[field] : value);
      all.push(...rows);
      if (rows.length < 100) return all;
    }
    throw new Error("paginação excedeu o limite; não é seguro assumir review completo");
  };
  return { github, root, api, pages };
}

/** Adaptador de publicação por CLI autenticada. Só expõe criar/localizar e ler; nunca merge/approve/auto-merge. */
export async function ensureRequest(cwd: string, draft: RequestDraft): Promise<ChangeRequest> {
  const t = await target(cwd);
  const endpoint = `${t.root}/${t.github ? "pulls" : "merge_requests"}`;
  const rows = await t.pages(
    `${endpoint}?state=all&${t.github ? "head" : "source_branch"}=${encodeURIComponent(t.github ? `${t.root.split("/")[1]}:${draft.branch}` : draft.branch)}`,
  );
  const found = t.github
    ? rows.map((r) => GhRequest.parse(r)).find((r) => r.head.ref === draft.branch && r.base.ref === draft.base)
    : rows
        .map((r) => GlRequest.parse(r))
        .find((r) => r.source_branch === draft.branch && r.target_branch === draft.base);
  let number = found && ("number" in found ? found.number : found.iid);
  if (!number) {
    const created = await t.api(
      endpoint,
      t.github
        ? { head: draft.branch, base: draft.base, title: draft.title, body: draft.body }
        : { source_branch: draft.branch, target_branch: draft.base, title: draft.title, description: draft.body },
    );
    number = t.github ? GhRequest.parse(created).number : GlRequest.parse(created).iid;
  }
  return inspectRequest(cwd, number);
}

export async function inspectRequest(cwd: string, number: number): Promise<ChangeRequest> {
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error("número de PR/MR inválido");
  const t = await target(cwd);
  const endpoint = `${t.root}/${t.github ? "pulls" : "merge_requests"}/${number}`;
  if (t.github) {
    const request = GhRequest.parse(await t.api(endpoint));
    const [issues, reviews, inline, runs, combined] = await Promise.all([
      t.pages(`${t.root}/issues/${number}/comments`),
      t.pages(`${endpoint}/reviews`),
      t.pages(`${endpoint}/comments`),
      t.pages(`${t.root}/commits/${request.head.sha}/check-runs`, "check_runs"),
      t.api(`${t.root}/commits/${request.head.sha}/status`),
    ]);
    const checks = runs.map((r) => z.object({ status: z.string(), conclusion: z.string().nullable() }).parse(r));
    const status = z.object({ state: z.string(), total_count: z.number() }).parse(combined);
    const failed =
      checks.some((c) => c.status === "completed" && !["success", "neutral", "skipped"].includes(c.conclusion ?? "")) ||
      ["failure", "error"].includes(status.state);
    const pending =
      checks.some((c) => c.status !== "completed") ||
      (status.total_count > 0 && status.state !== "success") ||
      (checks.length === 0 && status.total_count === 0) ||
      request.mergeable !== true;
    return {
      number,
      url: request.html_url,
      head: request.head.sha,
      state: request.merged ? "merged" : request.state === "open" ? "open" : "closed",
      checks: failed ? "failed" : pending ? "pending" : "passed",
      conflicts: request.mergeable === false,
      feedback: [issues, reviews, inline]
        .flatMap((rows, i) =>
          rows.map((raw) => {
            const n = Note.parse(raw);
            return { id: `${i}:${n.id}`, body: n.body ?? "", author: n.user?.login ?? "desconhecido" };
          }),
        )
        .filter((n) => n.body.trim() && !isAutomationText(n.body)),
    };
  }
  const request = GlRequest.parse(await t.api(endpoint));
  const [plain, discussions] = await Promise.all([t.pages(`${endpoint}/notes`), t.pages(`${endpoint}/discussions`)]);
  // Respostas de discussão levam as notas anteriores do mesmo fio como contexto; o id continua o da nota nova.
  const context = new Map<number, string>();
  const threaded = discussions.flatMap((d) => {
    const thread = z
      .object({ notes: z.array(z.unknown()).default([]) })
      .parse(d)
      .notes.map((raw) => Note.parse(raw));
    thread.forEach((n, i) => {
      const previous = thread.slice(0, i).filter((p) => !p.system && p.body?.trim());
      if (previous.length > 0)
        context.set(n.id, previous.map((p) => `> ${p.author?.username ?? "desconhecido"}: ${p.body ?? ""}`).join("\n"));
    });
    return thread;
  });
  const notes = [
    ...new Map([...plain.map((raw) => Note.parse(raw)), ...threaded].map((n) => [n.id, n] as const)).values(),
  ];
  const pipeline = request.head_pipeline;
  return {
    number,
    url: request.web_url,
    head: request.sha,
    state: request.state === "merged" ? "merged" : request.state === "opened" ? "open" : "closed",
    checks:
      pipeline?.sha !== request.sha
        ? "pending"
        : pipeline?.status === "success"
          ? "passed"
          : ["failed", "canceled"].includes(pipeline?.status ?? "")
            ? "failed"
            : "pending",
    conflicts: request.has_conflicts === true,
    feedback: notes
      .filter((n) => !n.system && n.body?.trim() && !isAutomationText(n.body))
      .map((n) => ({
        id: String(n.id),
        body: context.has(n.id)
          ? `Contexto da discussão:\n${context.get(n.id)}\n\nResposta:\n${n.body ?? ""}`
          : (n.body ?? ""),
        author: n.author?.username ?? "desconhecido",
      })),
  };
}
