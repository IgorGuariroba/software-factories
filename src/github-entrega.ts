import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { RawIssue } from "./github-demand-source.js";

// Recebimento de uma entrega do GitHub, sem estado: a assinatura HMAC do corpo e a interpretação do payload de `issues`
// e de instalação do App. O que fazer com a entrega (estado durável, efeitos) fica em github-webhook.ts.

const PREFIX = "sha256=";

/**
 * Confere o cabeçalho `X-Hub-Signature-256` do GitHub: HMAC-SHA256 do corpo cru (bytes, não texto) com o secret do App.
 * Falha fechado: sem secret, sem cabeçalho, prefixo diferente ou formato inválido resultam em `false`, nunca em erro.
 * A comparação é em tempo constante.
 */
export function verifyGitHubSignature(opts: { secret: string; body: Buffer; signature: string | undefined }): boolean {
  const { secret, body, signature } = opts;
  if (!secret || !signature?.startsWith(PREFIX)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const received = Buffer.from(signature.slice(PREFIX.length), "hex");
  // `Buffer.from` ignora caracteres inválidos em hex: a conferência de tamanho e a re-codificação os barram.
  if (received.length !== expected.length || received.toString("hex") !== signature.slice(PREFIX.length).toLowerCase())
    return false;
  return timingSafeEqual(expected, received);
}

// --- Parse do payload -----------------------------------------------------------------------------

/** Ações de `issues` que a fábrica conhece. Outras (ex.: `labeled`, `transferred`) são ignoradas. */
const ISSUE_ACTIONS = ["opened", "edited", "closed", "deleted", "reopened", "assigned", "unassigned"] as const;
export type IssueAction = (typeof ISSUE_ACTIONS)[number];

export type IssueDelivery = {
  /** Identificador da entrega (`X-GitHub-Delivery`), para idempotência. */
  deliveryId: string;
  action: IssueAction;
  /** Repositório "dono/nome", como veio no payload. */
  repo: string;
  /** Id numérico do repositório (estável; sobrevive a renomeação). Ausente só em entregas sem esse dado. */
  repoId?: number;
  /** Instalação do App que entregou o evento, quando o payload a traz. */
  installationId?: number;
  issue: RawIssue;
};

/** Ações de instalação que a fábrica trata: a instalação do App e os repositórios que ela alcança. */
export type InstallationAction = "created" | "deleted" | "suspend" | "added" | "removed";

export type InstallationDelivery = {
  deliveryId: string;
  action: InstallationAction;
  installationId: number;
  /** Repositórios "dono/nome" que a ação afeta (vazio quando o payload não os traz). */
  repos: string[];
  /** Id numérico de cada repositório afetado, pela chave em minúsculas (Fase 7: grava a identidade ao plugar). */
  repoIds?: Record<string, number>;
};

export type ParsedDelivery =
  | { kind: "issues"; delivery: IssueDelivery }
  | { kind: "instalacao"; delivery: InstallationDelivery }
  | { kind: "ignorado"; reason: string }
  | { kind: "invalido"; reason: string };

const InstallationPayload = z
  .object({
    action: z.string(),
    installation: z.object({ id: z.number().int().positive() }).passthrough(),
    repositories: z
      .array(z.object({ full_name: z.string(), id: z.number().int().positive().optional() }).passthrough())
      .optional(),
    repositories_added: z
      .array(z.object({ full_name: z.string(), id: z.number().int().positive().optional() }).passthrough())
      .optional(),
    repositories_removed: z
      .array(z.object({ full_name: z.string(), id: z.number().int().positive().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

/** Ações tratadas por evento. `unsuspend` fica de fora de propósito: o repositório volta pelo plugue, não sozinho. */
const INSTALLATION_ACTIONS: Record<string, readonly InstallationAction[]> = {
  installation: ["created", "deleted", "suspend"],
  installation_repositories: ["added", "removed"],
};

const IssuesPayload = z
  .object({
    action: z.string(),
    issue: z
      .object({
        number: z.number().int().positive(),
        title: z.string(),
        body: z.string().nullish(),
        state: z.string(),
        labels: z.array(z.union([z.string(), z.object({ name: z.string().optional() }).passthrough()])).optional(),
        pull_request: z.unknown().optional(),
        sub_issues_summary: z.object({ total: z.number().optional() }).passthrough().nullish(),
      })
      .passthrough(),
    repository: z.object({ full_name: z.string().min(3), id: z.number().int().positive().optional() }).passthrough(),
    installation: z.object({ id: z.number().int().positive() }).passthrough().optional(),
  })
  .passthrough();

/** Interpreta uma entrega do GitHub: `issues`, e instalação do App (`installation`, `installation_repositories`). */
export function parseGitHubDelivery(opts: {
  event: string | undefined;
  deliveryId: string | undefined;
  body: unknown;
}): ParsedDelivery {
  if (opts.event && opts.event in INSTALLATION_ACTIONS) return parseInstallation(opts.event, opts);
  if (opts.event !== "issues") return { kind: "ignorado", reason: `evento ${opts.event ?? "(sem nome)"} não tratado` };
  if (!opts.deliveryId) return { kind: "invalido", reason: "entrega sem X-GitHub-Delivery" };
  const parsed = IssuesPayload.safeParse(opts.body);
  if (!parsed.success) return { kind: "invalido", reason: "payload de issues incompleto" };
  const { action, issue, repository, installation } = parsed.data;
  if (!(ISSUE_ACTIONS as readonly string[]).includes(action))
    return { kind: "ignorado", reason: `ação issues.${action} não tratada` };
  return {
    kind: "issues",
    delivery: {
      deliveryId: opts.deliveryId,
      action: action as IssueAction,
      repo: repository.full_name,
      ...(repository.id !== undefined ? { repoId: repository.id } : {}),
      ...(installation ? { installationId: installation.id } : {}),
      issue: issue as RawIssue,
    },
  };
}

function parseInstallation(event: string, opts: { deliveryId: string | undefined; body: unknown }): ParsedDelivery {
  if (!opts.deliveryId) return { kind: "invalido", reason: "entrega sem X-GitHub-Delivery" };
  const parsed = InstallationPayload.safeParse(opts.body);
  if (!parsed.success) return { kind: "invalido", reason: `payload de ${event} incompleto` };
  const { action, installation } = parsed.data;
  if (!INSTALLATION_ACTIONS[event]?.includes(action as InstallationAction))
    return { kind: "ignorado", reason: `ação ${event}.${action} não tratada` };
  const repos =
    (action === "added"
      ? parsed.data.repositories_added
      : action === "removed"
        ? parsed.data.repositories_removed
        : parsed.data.repositories) ?? [];
  return {
    kind: "instalacao",
    delivery: {
      deliveryId: opts.deliveryId,
      action: action as InstallationAction,
      installationId: installation.id,
      repos: repos.map((r) => r.full_name),
      repoIds: Object.fromEntries(
        repos.flatMap((r) => (r.id !== undefined ? [[r.full_name.toLowerCase(), r.id] as const] : [])),
      ),
    },
  };
}
