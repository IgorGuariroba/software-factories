import { describe, expect, it } from "vitest";
import type { FactoryState, OrigemGitHub, QueuedTask } from "../src/durable.js";
import { chaveIssue, importacaoDoRepo, indiceIssues, tarefaDaIssue } from "../src/github-identidade.js";

/** Tarefa mínima; `origem` só entra quando o teste precisa dela. */
const tarefa = (id: string, origem?: QueuedTask["origem"]): QueuedTask =>
  ({
    id,
    project: "SF",
    key: id.split("/")[1] ?? id,
    title: id,
    status: "enfileirada",
    durableId: null,
    gateId: null,
    pauseRequested: false,
    notBefore: null,
    attempts: 0,
    reason: null,
    ...(origem ? { origem } : {}),
  }) as unknown as QueuedTask;

const origem = (repoId: number, issueNumber: number, issueId = issueNumber * 10): OrigemGitHub => ({
  repoId,
  repo: `dono/repo-${repoId}`,
  issueId,
  issueNumber,
});

describe("chaveIssue: identidade pelo id numérico do repositório", () => {
  it("o mesmo número de issue em repositórios diferentes não colide", () => {
    expect(chaveIssue(1, 12)).not.toBe(chaveIssue(2, 12));
  });
});

describe("tarefaDaIssue: a issue já importada não vira outra Tarefa", () => {
  it("encontra a Tarefa pela origem (repoId + número)", () => {
    const tasks = [tarefa("SF/SF-1", origem(100, 1)), tarefa("SF/SF-2", origem(100, 2))];
    expect(tarefaDaIssue(tasks, 100, 2)?.id).toBe("SF/SF-2");
  });

  it("não casa com a mesma issue de outro repositório", () => {
    const tasks = [tarefa("SF/SF-1", origem(100, 1))];
    expect(tarefaDaIssue(tasks, 200, 1)).toBeUndefined();
  });

  it("Tarefas sem origem (YAML ou busca antiga) nunca casam, mesmo com o mesmo número de card", () => {
    const tasks = [tarefa("SF/SF-7")];
    expect(tarefaDaIssue(tasks, 100, 7)).toBeUndefined();
  });

  it("renomear o repositório não muda a identidade: o casamento usa só o id", () => {
    const tasks = [tarefa("SF/SF-1", { ...origem(100, 1), repo: "antigo/nome" })];
    expect(tarefaDaIssue(tasks, 100, 1)?.id).toBe("SF/SF-1");
  });
});

describe("indiceIssues: unicidade por issue", () => {
  it("indexa as Tarefas com origem e ignora as demais", () => {
    const { porChave, duplicadas } = indiceIssues([tarefa("SF/SF-7"), tarefa("SF/SF-1", origem(100, 1))]);
    expect([...porChave.keys()]).toEqual([chaveIssue(100, 1)]);
    expect(duplicadas).toEqual([]);
  });

  it("uma segunda Tarefa para a mesma issue aparece como duplicada; a primeira prevalece", () => {
    const { porChave, duplicadas } = indiceIssues([
      tarefa("SF/SF-1", origem(100, 1)),
      tarefa("SF/SF-9", origem(100, 1)),
    ]);
    expect(porChave.get(chaveIssue(100, 1))?.id).toBe("SF/SF-1");
    expect(duplicadas).toEqual(["SF/SF-9"]);
  });
});

describe("estado sem os campos novos continua válido (Fase 1 é aditiva)", () => {
  it("um estado antigo, sem importacoes nem origem, não tem importação nem identidade GitHub", () => {
    const antigo: FactoryState = { daemonPaused: false, tasks: [tarefa("SF/SF-3")] };
    expect(importacaoDoRepo(antigo.importacoes, 100)).toBeUndefined();
    expect(tarefaDaIssue(antigo.tasks, 100, 3)).toBeUndefined();
  });

  it("registra a importação de um repositório pelo id e a devolve", () => {
    const estado: FactoryState = {
      daemonPaused: false,
      tasks: [],
      importacoes: {
        "100": { repoId: 100, repo: "dono/repo", status: "ok", ultimaImportacaoEm: "2026-11-09T12:00:00.000Z" },
      },
    };
    expect(importacaoDoRepo(estado.importacoes, 100)).toMatchObject({ status: "ok" });
    expect(importacaoDoRepo(estado.importacoes, 200)).toBeUndefined();
  });
});
