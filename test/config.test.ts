import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { startDaemon } from "../src/daemon.js";
import type { RunningFactory } from "../src/factory.js";
import { FakeTelegram, TELEGRAM_CHAT } from "./fakes/fake-telegram.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";

let dir: string;
let daemon: RunningFactory | undefined;
const source = new MemoryDemandSource([{ key: "PROJ-7", title: "t", status: "A Fazer", assignee: "seu-id-no-jira" }]);
const sources = { jira: () => source };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fabrica-config-"));
});
afterEach(async () => {
  await daemon?.close();
  daemon = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe("config de projeto", () => {
  it("o exemplo do repositório é válido e o daemon sobe com ele", async () => {
    await writeFile(join(dir, "exemplo.yaml"), await readFile("projects/example.yaml", "utf8"));

    daemon = await startDaemon({
      configDir: dir,
      sources,
      statePath: join(dir, "estado", "fabrica.sqlite"),
      models: createModels(),
    });
    const queue = (await (await fetch(`${daemon.url}/queue`)).json()) as { key: string }[];

    expect(queue.map((c) => c.key)).toEqual(["PROJ-7"]);
  });

  it("prioriza o prefixo específico no exemplo, antes do prefixo genérico da chave", async () => {
    const example = parse(await readFile("projects/example.yaml", "utf8")) as { repositories: { prefix: string }[] };
    expect(example.repositories.map((r) => r.prefix)).toEqual(["[mobile]", "PROJ"]);
  });

  it("recusa mapeamento por board, que a Fonte Jira não consegue determinar pelo card", async () => {
    const example = await readFile("projects/example.yaml", "utf8");
    await writeFile(join(dir, "board.yaml"), example.replace("prefix: PROJ", "prefix: PROJ\n    board: Mobile"));
    await expect(
      startDaemon({
        configDir: dir,
        sources,
        statePath: join(dir, "estado", "fabrica.sqlite"),
        models: createModels(),
      }),
    ).rejects.toThrow(/board/);
  });

  it("recusa iniciar com config inválida, dizendo arquivo, campo e motivo", async () => {
    await writeFile(
      join(dir, "quebrado.yaml"),
      "name: quebrado\nsource:\n  type: jira\n  project: PROJ\nstatuses:\n  A Fazer: fazendo\n",
    );

    const start = startDaemon({
      configDir: dir,
      sources,
      statePath: join(dir, "estado", "fabrica.sqlite"),
      models: createModels(),
    });

    await expect(start).rejects.toThrow(/quebrado\.yaml/);
    await expect(start).rejects.toThrow(/source\.assignee/);
    await expect(start).rejects.toThrow(/statuses\.A Fazer/);
  });

  it("baseUrl inválida vira erro de config com arquivo e campo, não exceção solta", async () => {
    const example = await readFile("projects/example.yaml", "utf8");
    await writeFile(
      join(dir, "url.yaml"),
      example.replace("assignee: seu-id-no-jira", "assignee: seu-id-no-jira\n  baseUrl: jira"),
    );
    const start = startDaemon({
      configDir: dir,
      sources,
      statePath: join(dir, "estado", "fabrica.sqlite"),
      models: createModels(),
    });
    await expect(start).rejects.toThrow(/url\.yaml: source\.baseUrl/);
  });

  it("aponta o arquivo com YAML malformado e continua validando os demais", async () => {
    await writeFile(join(dir, "a-malformado.yaml"), "name: [sem fechar\n");
    await writeFile(join(dir, "b-incompleto.yaml"), "name: b\n");

    const start = startDaemon({
      configDir: dir,
      sources,
      statePath: join(dir, "estado", "fabrica.sqlite"),
      models: createModels(),
    });

    await expect(start).rejects.toThrow(/a-malformado\.yaml: .*at line \d+, column \d+/);
    await expect(start).rejects.toThrow(/b-incompleto\.yaml: source/);
  });

  it("recusa um calendário de horas úteis inválido, dizendo o campo", async () => {
    const example = await readFile("projects/example.yaml", "utf8");
    await writeFile(
      join(dir, "calendario.yaml"),
      example
        .replace(/timezone: .*/, "timezone: Lugar/Nenhum")
        .replace(/start: "09:00"/, 'start: "19:00"')
        .replace(/role: po/, "role: chefe"),
    );

    const start = startDaemon({
      configDir: dir,
      sources,
      statePath: join(dir, "estado", "fabrica.sqlite"),
      models: createModels(),
    });

    await expect(start).rejects.toThrow(/calendar\.timezone: fuso horário IANA desconhecido/);
    await expect(start).rejects.toThrow(/calendar\.end: start precisa ser antes de end/);
    await expect(start).rejects.toThrow(/people\.0\.role/);
  });

  it("recusa um nível de conteúdo do Telegram desconhecido", async () => {
    const example = await readFile("projects/example.yaml", "utf8");
    await writeFile(join(dir, "telegram.yaml"), example.replace(/content: full/, "content: tudo"));

    const start = startDaemon({
      configDir: dir,
      sources,
      statePath: join(dir, "estado", "fabrica.sqlite"),
      models: createModels(),
    });

    await expect(start).rejects.toThrow(/telegram\.content/);
  });

  it("com uma interface de gestão, o daemon publica nela no nível do projeto", async () => {
    const example = await readFile("projects/example.yaml", "utf8");
    expect(example).toMatch(/content: full/);
    await writeFile(join(dir, "exemplo.yaml"), example.replace(/content: full/, "content: minimal"));
    const telegram = new FakeTelegram();

    daemon = await startDaemon({
      configDir: dir,
      sources,
      statePath: join(dir, "estado", "fabrica.sqlite"),
      models: createModels(),
      management: { port: telegram, chat: TELEGRAM_CHAT },
    });
    await fetch(`${daemon.url}/poll`, { method: "POST" });

    await vi.waitFor(() => expect(telegram.texts()).toContain("Assumi o card PROJ-7 (exemplo)."));
  });

  it("recusa iniciar sem nenhum projeto configurado", async () => {
    await expect(
      startDaemon({
        configDir: dir,
        sources,
        statePath: join(dir, "estado", "fabrica.sqlite"),
        models: createModels(),
      }),
    ).rejects.toThrow(/nenhum projeto/i);
  });
});
