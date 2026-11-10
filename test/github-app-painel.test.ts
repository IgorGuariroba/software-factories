import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectConfig } from "../src/config.js";
import { parseGitHubDelivery } from "../src/github-webhook.js";
import { api, startTestFactory, type TestFactory } from "./harness.js";

const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** API do GitHub falsa: o App e uma instalação que cobre `IgorGuariroba/software-factories`. */
const githubFalso = (() => {
  const fetchFalso = async (url: string) => {
    const caminho = new URL(url).pathname;
    if (caminho === "/app") return json({ id: 5685212, slug: "fabrica-igor-sf", name: "fabrica-igor-sf" });
    if (caminho === "/app/installations") {
      return json([{ id: 180265101, account: { login: "IgorGuariroba" }, repository_selection: "selected" }]);
    }
    if (caminho === "/app/installations/180265101/access_tokens") return json({ token: "ghs_token_falso" });
    if (caminho === "/installation/repositories") {
      return json({ repositories: [{ full_name: "IgorGuariroba/software-factories" }] });
    }
    return json({ message: "Not Found" }, 404);
  };
  return fetchFalso as unknown as typeof fetch;
})();

const githubConfig = (repo: string): Partial<ProjectConfig> => ({
  source: {
    type: "github",
    project: "SF",
    repo,
    assignee: "igor",
    triageApproval: false,
    maxActive: 1,
    ignoreLabels: [],
  } as ProjectConfig["source"],
});

let factory: TestFactory | undefined;
afterEach(async () => {
  await factory?.close();
  factory = undefined;
});

type Painel = {
  receptor: { ligado: boolean; porta: number | null; ultimaEntregaEm: string | null };
  app: { configurado: boolean; erro?: string; instalacoes: { conta: string; repositorios: string[] }[] };
  repositorios: { repo: string; status: string; coberto: boolean | null }[];
};

async function chaveNoDisco(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fabrica-chave-"));
  const caminho = join(dir, "app.private-key.pem");
  await writeFile(caminho, PEM, { mode: 0o600 });
  return caminho;
}

describe("GET /github-app: o painel do App em Configurações", () => {
  it("sem App configurado, diz isso e não afirma cobertura", async () => {
    factory = await startTestFactory({ config: githubConfig("dono/repo") });
    const painel = await api<Painel>(factory, "GET", "/github-app");
    expect(painel.app.configurado).toBe(false);
    expect(painel.receptor).toMatchObject({ ligado: false, porta: null, ultimaEntregaEm: null });
    expect(painel.repositorios).toEqual([
      expect.objectContaining({ repo: "dono/repo", status: "ativo", coberto: null }),
    ]);
  });

  it("com o App configurado, mostra as instalações e marca a cobertura de cada repositório plugado", async () => {
    factory = await startTestFactory({
      config: githubConfig("IgorGuariroba/software-factories"),
      githubApp: { appId: 5685212, privateKeyPath: await chaveNoDisco(), fetch: githubFalso },
    });
    const painel = await api<Painel>(factory, "GET", "/github-app");
    expect(painel.app).toMatchObject({
      configurado: true,
      instalacoes: [{ conta: "IgorGuariroba", repositorios: ["IgorGuariroba/software-factories"] }],
    });
    expect(painel.repositorios).toEqual([
      expect.objectContaining({ repo: "IgorGuariroba/software-factories", coberto: true }),
    ]);
  });

  it("mostra o receptor ligado e o horário da última entrega do webhook aplicada", async () => {
    factory = await startTestFactory({ webhookSecret: "segredo-do-teste" });
    const antes = await api<Painel>(factory, "GET", "/github-app");
    expect(antes.receptor.ligado).toBe(true);
    expect(antes.receptor.porta).not.toBeNull();
    expect(antes.receptor.ultimaEntregaEm).toBeNull();

    const parsed = parseGitHubDelivery({
      event: "issues",
      deliveryId: "entrega-painel-1",
      body: {
        action: "edited",
        issue: { number: 3, title: "Editada", body: "", state: "open", labels: [] },
        repository: { full_name: "outro/repo" },
      },
    });
    if (parsed.kind !== "issues") throw new Error("entrega de teste inválida");
    await factory.applyGitHubDelivery(parsed.delivery);

    const depois = await api<Painel>(factory, "GET", "/github-app");
    expect(depois.receptor.ultimaEntregaEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("uma falha da consulta ao App aparece como erro, e a cobertura fica desconhecida", async () => {
    const falha = (async () => json({ message: "Bad credentials" }, 401)) as unknown as typeof fetch;
    factory = await startTestFactory({
      config: githubConfig("dono/repo"),
      githubApp: { appId: 5685212, privateKeyPath: await chaveNoDisco(), fetch: falha },
    });
    const painel = await api<Painel>(factory, "GET", "/github-app");
    expect(painel.app.erro).toBe("GitHub respondeu 401 em /app");
    expect(painel.repositorios[0]?.coberto).toBeNull();
  });
});
