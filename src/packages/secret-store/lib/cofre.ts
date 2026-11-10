import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Metadados de um segredo: nunca inclui o valor. */
export interface SecretInfo {
  nome: string;
  /** Última gravação (ISO 8601). */
  atualizadoEm: string;
}

/**
 * Porta de credenciais (ADR-0018). `get` é para uso interno da fábrica; a interface e a API só usam `put`, `has` e
 * `list`, que nunca devolvem o valor.
 */
export interface SecretStore {
  put(nome: string, valor: string): Promise<SecretInfo>;
  get(nome: string): Promise<string | undefined>;
  has(nome: string): Promise<boolean>;
  list(): Promise<SecretInfo[]>;
}

interface Registro {
  iv: string;
  tag: string;
  dados: string;
  atualizadoEm: string;
}

const ARQUIVO = "segredos.json";
const CHAVE = "chave.bin";

/**
 * Cofre em disco: cada valor é cifrado com AES-256-GCM. A chave fica num arquivo separado, com permissão só do dono, e
 * é criada na primeira gravação. Sem a chave, o arquivo de segredos não se decifra.
 */
export function createSecretStore(opts: { dir: string }): SecretStore {
  const arquivo = join(opts.dir, ARQUIVO);
  const arquivoChave = join(opts.dir, CHAVE);

  async function chave(): Promise<Buffer> {
    if (!existsSync(arquivoChave)) {
      await mkdir(opts.dir, { recursive: true });
      await writeFile(arquivoChave, randomBytes(32), { mode: 0o600 });
    }
    return readFile(arquivoChave);
  }

  async function registros(): Promise<Record<string, Registro>> {
    if (!existsSync(arquivo)) return {};
    return JSON.parse(await readFile(arquivo, "utf8")) as Record<string, Registro>;
  }

  async function gravar(todos: Record<string, Registro>): Promise<void> {
    await mkdir(opts.dir, { recursive: true });
    const temporario = `${arquivo}.tmp`;
    await writeFile(temporario, JSON.stringify(todos), { mode: 0o600 });
    await rename(temporario, arquivo);
  }

  function decifrar(registro: Registro, key: Buffer): string {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(registro.iv, "base64"));
    decipher.setAuthTag(Buffer.from(registro.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(registro.dados, "base64")), decipher.final()]).toString("utf8");
  }

  return {
    async put(nome, valor) {
      const key = await chave();
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const dados = Buffer.concat([cipher.update(valor, "utf8"), cipher.final()]);
      const atualizadoEm = new Date().toISOString();
      const todos = await registros();
      todos[nome] = {
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        dados: dados.toString("base64"),
        atualizadoEm,
      };
      await gravar(todos);
      return { nome, atualizadoEm };
    },

    async get(nome) {
      const registro = (await registros())[nome];
      if (!registro) return undefined;
      return decifrar(registro, await chave());
    },

    async has(nome) {
      return nome in (await registros());
    },

    async list() {
      return Object.entries(await registros()).map(([nome, r]) => ({ nome, atualizadoEm: r.atualizadoEm }));
    },
  };
}
