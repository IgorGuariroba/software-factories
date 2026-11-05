import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Diretório da página de gestão (HTML, CSS e JS puro, sem build). Fica na raiz do repositório, ao lado de `src/` e de
 * `dist/`: tanto `src/web.ts` (tsx) quanto `dist/web.js` (compilado) o acham em `../web/`.
 */
export const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url));

/** Prefixo fixo dos assets da página. */
export const WEB_PREFIX = "/web/";

/**
 * Só o que vem da própria origem; nada inline, nada de plugins, frames ou formulários para fora. A página monta o DOM
 * com `textContent`, então conteúdo do card ou do modelo nunca vira HTML.
 */
export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
};

/** Nome de asset aceito: um arquivo direto do diretório, sem barras nem `..`. */
const ASSET = /^[a-z0-9-]+\.(js|css)$/;

export interface WebFile {
  headers: Record<string, string>;
  body: Buffer;
}

/** O arquivo da página para `pathname` (`/` ou `/web/<asset>`), ou `undefined` se não for um arquivo da página. */
export async function webFile(pathname: string): Promise<WebFile | undefined> {
  let name: string;
  if (pathname === "/") name = "index.html";
  else if (pathname.startsWith(WEB_PREFIX) && ASSET.test(pathname.slice(WEB_PREFIX.length)))
    name = pathname.slice(WEB_PREFIX.length);
  else return undefined;
  let body: Buffer;
  try {
    body = await readFile(join(WEB_DIR, name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  return {
    body,
    headers: {
      "content-type": TYPES[name.slice(name.lastIndexOf(".") + 1)] as string,
      "content-security-policy": WEB_CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
    },
  };
}
