import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Card, CardComment, DemandSource, TextAttachment } from "./demand-source.js";

const execFileAsync = promisify(execFile);

export interface AcliExecResult {
  stdout: string;
  stderr: string;
  exitCode?: number;
}

/** Runner injetável para comandos do acli. Permite testes sem invocar o binário real. */
export type AcliRunner = (args: string[]) => Promise<AcliExecResult>;

interface AttachmentInfo {
  id: string;
  filename: string;
  mimeType?: string;
  contentUrl?: string;
  size?: number;
}

type AttachmentReader = (attachment: AttachmentInfo) => Promise<string>;

export interface JiraDemandSourceOptions {
  /** Chave do projeto no Jira (ex.: "PROJ"). */
  project: string;
  /** Identificador do usuário atribuído no Jira (accountId, email ou username). */
  assignee: string;
  /** Runner customizado do acli (para testes ou customização de path). */
  runner?: AcliRunner;
  /**
   * Ambiente de onde vêm as credenciais dos anexos (`ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`). Padrão: `process.env`.
   */
  env?: Record<string, string | undefined>;
  /** `fetch` usado para baixar o conteúdo dos anexos de texto. Padrão: o global. */
  fetch?: typeof fetch;
  /** Prazo de download de anexos em milissegundos. Padrão: 60 segundos. */
  timeoutMs?: number;
}

/**
 * Runner padrão que localiza o acli (incluindo ~/.local/bin) e executa o binário.
 */
const defaultAcliRunner: AcliRunner = async (args: string[]) => {
  const customPath = process.env.ACLI_PATH;
  const acliBin = customPath || "acli";
  const userLocalBin = join(homedir(), ".local", "bin");
  const currentPath = process.env.PATH ?? "";
  const pathWithLocal = currentPath.includes(userLocalBin) ? currentPath : `${userLocalBin}:${currentPath}`;

  try {
    const { stdout, stderr } = await execFileAsync(acliBin, args, {
      maxBuffer: 20 * 1024 * 1024,
      timeout: 120_000,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: pathWithLocal,
      },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr?.trim() || `código ${err.code ?? "desconhecido"}`,
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
};

const MISSING_ATTACHMENT_CREDENTIALS = "[conteúdo não lido: defina ATLASSIAN_EMAIL e ATLASSIAN_API_TOKEN]";

/**
 * Leitor de anexos por HTTP com autenticação básica (`ATLASSIAN_EMAIL` + `ATLASSIAN_API_TOKEN`), já que o `acli` não
 * baixa anexos. Sem credencial, devolve um conteúdo que diz isso explicitamente. Com credencial, qualquer falha lança
 * erro (a Tarefa é tentada de novo). O token nunca aparece na mensagem de erro.
 */
function createHttpAttachmentReader(
  opts: { env?: Record<string, string | undefined>; fetch?: typeof fetch; timeoutMs?: number } = {},
): AttachmentReader {
  return async (attachment) => {
    const env = opts.env ?? process.env;
    const email = env.ATLASSIAN_EMAIL;
    const token = env.ATLASSIAN_API_TOKEN;
    if (!email || !token) return MISSING_ATTACHMENT_CREDENTIALS;
    const what = `anexo ${attachment.filename} (id ${attachment.id})`;
    if (!attachment.contentUrl) throw new Error(`Falha ao ler ${what}: o Jira não informou a URL do conteúdo`);
    const doFetch = opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(attachment.contentUrl, {
        headers: { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
    } catch (error) {
      throw new Error(`Falha de rede ao baixar ${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!res.ok) throw new Error(`Falha ao baixar ${what}: HTTP ${res.status}`);
    return await res.text();
  };
}

/** Nós ADF que terminam numa quebra de linha. */
const BLOCK_TYPES = new Set(["paragraph", "heading", "codeBlock", "listItem", "blockquote"]);

/**
 * Converte documento no formato Atlassian Document Format (ADF) ou string para texto plano legível.
 */
function adfToText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";

  const n = node as {
    type?: string;
    text?: string;
    content?: unknown[];
    attrs?: { text?: string; id?: string };
  };

  if (typeof n.text === "string") return n.text;
  if (n.type === "hardBreak" || n.type === "rule") return "\n";
  if (n.type === "mention") return n.attrs?.text ?? (n.attrs?.id ? `[~accountid:${n.attrs.id}]` : "");

  const inner = Array.isArray(n.content) ? n.content.map(adfToText).join("") : "";
  if (!BLOCK_TYPES.has(n.type ?? "")) return inner;
  return inner.endsWith("\n") ? inner : `${inner}\n`;
}

/** Verifica se um anexo é de texto e não binário (imagem, pdf, zip, etc). */
function isTextAttachment(filename: string, mimeType?: string): boolean {
  const binaryExtRegex = /\.(png|jpe?g|gif|webp|bmp|pdf|zip|tar|gz|tgz|7z|rar|bin|exe|jar|war|ear|iso|dmg)$/i;
  if (binaryExtRegex.test(filename)) return false;

  if (mimeType) {
    if (mimeType.startsWith("text/")) return true;
    if (
      mimeType === "application/json" ||
      mimeType === "application/xml" ||
      mimeType === "application/javascript" ||
      mimeType === "application/typescript" ||
      mimeType === "application/x-yaml" ||
      mimeType === "application/yaml"
    ) {
      return true;
    }
  }

  const textExtRegex = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|log|diff|patch|[jt]sx?|py|sh|sql)$/i;
  return textExtRegex.test(filename);
}

/** Mensagens do `acli` para um card que comprovadamente não existe. */
const NOT_FOUND = /não existe|nao existe|not found|does not exist/i;

interface JiraPerson {
  accountId?: string;
  emailAddress?: string;
  displayName?: string;
}

interface JiraIssue {
  key?: string;
  fields?: Record<string, unknown>;
}

/** Procura o id de um comentário criado em formatos variados de resposta (`{id}`, `{comment:{id}}`, `[{id}]`...). */
function findCommentId(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.length === 1 ? findCommentId(value[0], depth + 1) : undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.id === "string" && v.id) return v.id;
  if (typeof v.id === "number") return String(v.id);
  for (const k of ["comment", "data", "result"]) {
    const id = findCommentId(v[k], depth + 1);
    if (id) return id;
  }
  return undefined;
}

/**
 * Adaptador da Fonte Jira usando o binário Atlassian CLI (`acli`).
 *
 * Toda falha de leitura lança erro com contexto (a Tarefa é tentada de novo): uma lista vazia ou um card ausente por
 * engano faria a fábrica duplicar comentários ou bloquear a tarefa. A única exceção é `getCard` de um card que não
 * existe, que devolve `undefined`.
 *
 * Identidade: pessoas (responsável do card, autor de comentário) viram `assignee` (o valor configurado, exatamente)
 * quando ele é o accountId ou o e-mail da pessoa; senão, o accountId dela.
 */
export class JiraDemandSource implements DemandSource {
  readonly project: string;
  readonly assignee: string;
  private readonly runner: AcliRunner;
  private readonly readAttachment: AttachmentReader;

  constructor(opts: JiraDemandSourceOptions) {
    this.project = opts.project;
    this.assignee = opts.assignee;
    this.runner = opts.runner ?? defaultAcliRunner;
    this.readAttachment = createHttpAttachmentReader({ env: opts.env, fetch: opts.fetch, timeoutMs: opts.timeoutMs });
  }

  private isKeyInProject(key: string): boolean {
    return key.startsWith(`${this.project}-`);
  }

  private normalizePerson(person: unknown): string {
    if (!person) return "";
    if (typeof person === "string") return person;
    const p = person as JiraPerson;
    if (p.accountId === this.assignee || p.emailAddress === this.assignee) return this.assignee;
    return p.accountId ?? "";
  }

  /**
   * Executa o `acli`; lança erro com comando, card e stderr se ele falhar. `command` é a descrição do comando nas
   * mensagens (sem o corpo de comentários). Com `notFound`, devolve `undefined` se o card não existe.
   */
  private async run(args: string[], command: string, key: string, notFound = false): Promise<string | undefined> {
    const res = await this.runner(args);
    if (res.exitCode === 0) return res.stdout;
    // O acli pode ecoar o corpo privado tanto em stderr quanto em stdout; não o registramos em falhas de escrita.
    const output = args.includes("--body")
      ? "detalhes omitidos para proteger o corpo do comentário"
      : (res.stderr || res.stdout).trim();
    if (notFound && NOT_FOUND.test(output)) return undefined;
    throw new Error(`acli ${command} falhou (card ${key}, exit ${res.exitCode ?? "?"}): ${output}`);
  }

  private parse<T>(stdout: string, command: string, key: string): T {
    try {
      return JSON.parse(stdout) as T;
    } catch {
      throw new Error(`acli ${command} devolveu JSON inválido (card ${key}): ${stdout.slice(0, 200)}`);
    }
  }

  private toCard(item: JiraIssue): Card {
    const fields = item.fields ?? {};
    const description = adfToText(fields.description).trim();
    return {
      key: String(item.key),
      title: String(fields.summary ?? ""),
      status: String((fields.status as { name?: string } | undefined)?.name ?? ""),
      assignee: this.normalizePerson(fields.assignee),
      description: description || undefined,
    };
  }

  formatMention(personId: string): string {
    const cleanId = personId.replace(/^accountid:/i, "");
    return `[~accountid:${cleanId}]`;
  }

  async listAssignedCards(assignee: string): Promise<Card[]> {
    const jql = `project = "${this.project}" AND assignee = "${assignee}"`;
    const fields = "key,summary,status,assignee,description";
    const command = `jira workitem search --jql '${jql}'`;
    const args = ["jira", "workitem", "search", "--jql", jql, "--fields", fields, "--json", "--paginate"];
    const stdout = (await this.run(args, command, this.project)) ?? "";
    const parsed = this.parse<unknown>(stdout, command, this.project);
    if (!Array.isArray(parsed)) throw new Error(`acli ${command} não devolveu uma lista de cards`);
    return (parsed as JiraIssue[])
      .filter((item) => typeof item?.key === "string" && this.isKeyInProject(item.key))
      .map((item) => this.toCard(item));
  }

  async getCard(key: string): Promise<Card | undefined> {
    if (!this.isKeyInProject(key)) return undefined;
    const command = `jira workitem view ${key}`;
    const fields = "key,summary,status,assignee,description";
    const stdout = await this.run(["jira", "workitem", "view", key, "--fields", fields, "--json"], command, key, true);
    if (stdout === undefined) return undefined;
    const item = this.parse<JiraIssue>(stdout, command, key);
    if (typeof item?.key !== "string") throw new Error(`acli ${command} devolveu um card sem chave`);
    return this.isKeyInProject(item.key) ? this.toCard(item) : undefined;
  }

  async listComments(key: string): Promise<CardComment[]> {
    if (!this.isKeyInProject(key)) return [];
    const command = `jira workitem view ${key} --fields comment`;
    const stdout =
      (await this.run(["jira", "workitem", "view", key, "--fields", "comment", "--json"], command, key)) ?? "";
    const item = this.parse<JiraIssue>(stdout, command, key);
    const field = item?.fields?.comment as { comments?: unknown[]; total?: number } | undefined;
    if (!field || !Array.isArray(field.comments))
      throw new Error(`acli ${command} não devolveu o campo de comentários`);
    const received = field.comments.length;
    if (typeof field.total === "number" && field.total > received) {
      throw new Error(`acli ${command} devolveu só ${received} de ${field.total} comentários do card ${key}`);
    }
    return field.comments.map((c) => {
      const raw = (c ?? {}) as { id?: string | number; author?: unknown; body?: unknown };
      return { id: String(raw.id ?? ""), author: this.normalizePerson(raw.author), body: adfToText(raw.body).trim() };
    });
  }

  async listTextAttachments(key: string): Promise<TextAttachment[]> {
    if (!this.isKeyInProject(key)) return [];
    const command = `jira workitem view ${key} --fields attachment`;
    const stdout =
      (await this.run(["jira", "workitem", "view", key, "--fields", "attachment", "--json"], command, key)) ?? "";
    const item = this.parse<JiraIssue>(stdout, command, key);
    const list = item?.fields?.attachment ?? [];
    if (!Array.isArray(list)) throw new Error(`acli ${command} não devolveu uma lista de anexos`);

    const attachments: TextAttachment[] = [];
    for (const raw of list as {
      id?: string | number;
      filename?: string;
      mimeType?: string;
      content?: string;
      size?: number;
    }[]) {
      const filename = String(raw?.filename ?? "");
      if (!filename || !isTextAttachment(filename, raw.mimeType)) continue;
      const content = await this.readAttachment({
        id: String(raw.id ?? ""),
        filename,
        mimeType: raw.mimeType,
        contentUrl: raw.content,
        size: raw.size,
      });
      attachments.push({ name: filename, content });
    }
    return attachments;
  }

  async addComment(key: string, body: string): Promise<{ id: string }> {
    const command = `jira workitem comment create --key ${key}`;
    const args = ["jira", "workitem", "comment", "create", "--key", key, "--body", body, "--json"];
    const stdout = (await this.run(args, command, key)) ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = undefined;
    }
    const id = findCommentId(parsed);
    if (id) return { id };

    // A resposta não trouxe o id: o comentário criado é o meu mais recente que começa com a primeira linha do corpo.
    const firstLine = body.trim().split("\n")[0];
    const mine = (await this.listComments(key)).filter(
      (c) => c.author === this.assignee && c.body.startsWith(firstLine),
    );
    const found = mine.at(-1);
    if (found) return { id: found.id };
    throw new Error(`acli ${command}: não foi possível descobrir o id do comentário criado no card ${key}`);
  }

  async editComment(key: string, commentId: string, body: string): Promise<void> {
    const args = ["jira", "workitem", "comment", "update", "--key", key, "--id", commentId, "--body", body];
    await this.run(args, `jira workitem comment update --key ${key} --id ${commentId}`, key);
  }

  async transition(key: string, status: string): Promise<void> {
    const args = ["jira", "workitem", "transition", "--key", key, "--status", status, "--yes"];
    await this.run(args, `jira workitem transition --key ${key} --status '${status}'`, key);
  }
}

export function createJiraDemandSource(opts: JiraDemandSourceOptions): JiraDemandSource {
  return new JiraDemandSource(opts);
}
