#!/usr/bin/env node
/**
 * Portão do review: falha o check enquanto houver achado Critical ou Major do PR-Agent em thread não resolvida.
 * Política: Critical/Major bloqueiam até a thread ser resolvida; Minor e Trivial não bloqueiam.
 * Uso no CI: GITHUB_TOKEN, GITHUB_REPOSITORY (dono/nome) e PR_NUMBER no ambiente.
 */
import { pathToFileURL } from "node:url";

const PR_AGENT = new Set(["github-actions", "github-actions[bot]"]);
const BLOCKING = /\*\*(Critical|Major)\*\*\s*·/;

/**
 * @param {{isResolved: boolean, path?: string, line?: number | null,
 *   comments: {nodes: {author: {login: string} | null, body: string, url?: string}[]}}[]} threads
 * @returns {{severity: string, path?: string, line?: number | null, url?: string}[]}
 */
export function blockingThreads(threads) {
  return threads.flatMap((thread) => {
    const first = thread.comments.nodes[0];
    if (thread.isResolved || !first || !PR_AGENT.has(first.author?.login ?? "")) return [];
    const match = BLOCKING.exec(first.body);
    return match ? [{ severity: match[1], path: thread.path, line: thread.line, url: first.url }] : [];
  });
}

const QUERY = `query($owner: String!, $name: String!, $pr: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { isResolved path line comments(first: 1) { nodes { author { login } body url } } }
      }
    }
  }
}`;

async function fetchThreads({ token, repository, pr }) {
  const [owner, name] = repository.split("/");
  const threads = [];
  let after = null;
  for (;;) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { owner, name, pr, after } }),
    });
    const json = await res.json();
    if (!res.ok || json.errors) throw new Error(`GraphQL falhou: ${JSON.stringify(json.errors ?? res.status)}`);
    const page = json.data.repository.pullRequest.reviewThreads;
    threads.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return threads;
    after = page.pageInfo.endCursor;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository, PR_NUMBER } = process.env;
  if (!token || !repository || !PR_NUMBER) throw new Error("defina GITHUB_TOKEN, GITHUB_REPOSITORY e PR_NUMBER");
  const blocking = blockingThreads(await fetchThreads({ token, repository, pr: Number(PR_NUMBER) }));
  for (const b of blocking) console.log(`::error file=${b.path ?? ""},line=${b.line ?? 1}::${b.severity} sem resolver: ${b.url ?? ""}`);
  if (blocking.length > 0) {
    console.log(`${blocking.length} achado(s) Critical/Major do PR-Agent sem resolver. Resolva a thread e rode o job de novo.`);
    process.exit(1);
  }
  console.log("Nenhum achado Critical/Major do PR-Agent pendente.");
}
