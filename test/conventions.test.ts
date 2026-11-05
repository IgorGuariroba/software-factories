import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverGitConventions,
  formatBranchName,
  formatCommitMessage,
  resolveConventions,
} from "../src/conventions.js";

const pexec = promisify(execFile);

describe("descoberta e sobrescrita de convenções de branch e commit", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "repo-conventions-test-"));
    await pexec("git", ["init", "-b", "main"], { cwd: repoDir });
    await pexec("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    await pexec("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("descobre padrão de commits com chave no final e padrão de branch feature/", async () => {
    // Cria commit inicial
    await pexec("git", ["commit", "--allow-empty", "-m", "chore: commit inicial"], { cwd: repoDir });
    // Cria commits seguindo padrão {type}: {summary} ({key})
    await pexec("git", ["commit", "--allow-empty", "-m", "feat: tela de login (PROJ-10)"], { cwd: repoDir });
    await pexec("git", ["commit", "--allow-empty", "-m", "test: teste de login (PROJ-10)"], { cwd: repoDir });
    await pexec("git", ["commit", "--allow-empty", "-m", "fix: corrige validação (PROJ-11)"], { cwd: repoDir });

    // Cria branches com padrão feature/
    await pexec("git", ["branch", "feature/PROJ-10-tela-login"], { cwd: repoDir });
    await pexec("git", ["branch", "feature/PROJ-11-validacao"], { cwd: repoDir });

    const discovered = await discoverGitConventions(repoDir);
    expect(discovered.branch).toBe("feature/{key}-{slug}");
    expect(discovered.commit).toBe("{type}: {summary} ({key})");

    const resolved = resolveConventions(discovered);
    const branchName = formatBranchName(resolved, { key: "PROJ-1", title: "Exportar relatório em CSV" });
    expect(branchName).toBe("feature/PROJ-1-exportar-relatorio-em-csv");

    const commitMsg = formatCommitMessage(resolved, {
      type: "feat",
      summary: "adiciona exportação",
      key: "PROJ-1",
    });
    expect(commitMsg).toBe("feat: adiciona exportação (PROJ-1)");
  });

  it("descobre padrão feat/ quando predominante", async () => {
    await pexec("git", ["commit", "--allow-empty", "-m", "chore: inicial"], { cwd: repoDir });
    await pexec("git", ["branch", "feat/PROJ-1-foo"], { cwd: repoDir });
    await pexec("git", ["branch", "feat/PROJ-2-bar"], { cwd: repoDir });

    const discovered = await discoverGitConventions(repoDir);
    expect(discovered.branch).toBe("feat/{key}-{slug}");
  });

  it("descobre padrão convencional puro quando os commits não têm chave", async () => {
    await pexec("git", ["commit", "--allow-empty", "-m", "chore: setup"], { cwd: repoDir });
    await pexec("git", ["commit", "--allow-empty", "-m", "feat: nova funcionalidade"], { cwd: repoDir });
    await pexec("git", ["commit", "--allow-empty", "-m", "test: adiciona cobertura"], { cwd: repoDir });

    const discovered = await discoverGitConventions(repoDir);
    expect(discovered.commit).toBe("{type}: {summary}");
  });

  it("config sobrescreve as convenções descobertas no repositório", async () => {
    await pexec("git", ["commit", "--allow-empty", "-m", "chore: inicial"], { cwd: repoDir });
    await pexec("git", ["commit", "--allow-empty", "-m", "feat: login (PROJ-1)"], { cwd: repoDir });
    await pexec("git", ["branch", "feature/PROJ-1-login"], { cwd: repoDir });

    const discovered = await discoverGitConventions(repoDir);
    const overrides = {
      branch: "tarefa/{key}",
      commit: "[{key}] {type}: {summary}",
    };
    const resolved = resolveConventions(discovered, overrides);

    expect(formatBranchName(resolved, { key: "PROJ-99", title: "Qualquer título" })).toBe("tarefa/PROJ-99");
    expect(
      formatCommitMessage(resolved, {
        type: "test",
        summary: "teste de contrato",
        key: "PROJ-99",
      }),
    ).toBe("[PROJ-99] test: teste de contrato");
  });
});
