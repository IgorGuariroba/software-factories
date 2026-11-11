import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { caminhosTocadosDesde, commitarCaminhos, descartarCaminhos, fatosDoRed } from "../src/implement-clone.js";

// Operações git do clone da implementação, em repositório real e temporário.

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).trim();

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "impl-clone-"));
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.name", "t");
  sh(repo, "config", "user.email", "t@t");
  writeFileSync(join(repo, "a.txt"), "original\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "base");
});

describe("descartarCaminhos", () => {
  it("restaura arquivo rastreado e apaga arquivo novo", async () => {
    writeFileSync(join(repo, "a.txt"), "alterado\n");
    writeFileSync(join(repo, "novo.txt"), "novo\n");
    await descartarCaminhos(repo, ["a.txt", "novo.txt"]);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("original\n");
    expect(existsSync(join(repo, "novo.txt"))).toBe(false);
  });
});

describe("commitarCaminhos", () => {
  it("commita só os caminhos informados e devolve o SHA do novo HEAD", async () => {
    writeFileSync(join(repo, "a.txt"), "v2\n");
    writeFileSync(join(repo, "outro.txt"), "fora\n");
    const sha = await commitarCaminhos(repo, ["a.txt"], "feat: troca a e nada mais");
    expect(sha).toBe(sh(repo, "rev-parse", "HEAD"));
    expect(sh(repo, "log", "-1", "--format=%s")).toBe("feat: troca a e nada mais");
    expect(sh(repo, "status", "--porcelain")).toBe("?? outro.txt");
  });
});

describe("fatosDoRed e caminhosTocadosDesde", () => {
  it("lista assuntos e caminhos entre o RED e o HEAD", async () => {
    writeFileSync(join(repo, "teste.txt"), "red\n");
    const red = await commitarCaminhos(repo, ["teste.txt"], "test: adiciona teste");
    writeFileSync(join(repo, "teste.txt"), "red  \n");
    writeFileSync(join(repo, "a.txt"), "green\n");
    await commitarCaminhos(repo, ["a.txt", "teste.txt"], "feat: implementa");
    const head = sh(repo, "rev-parse", "HEAD");
    const fatos = await fatosDoRed(repo, red, head);
    expect(fatos.assuntos).toEqual(["feat: implementa"]);
    expect(fatos.caminhos).toEqual(["a.txt", "teste.txt"]);
    // Só a diferença de espaços em teste.txt some quando ignoramos espaços; a de a.txt continua.
    expect(fatos.diffSemEspacos).toContain("+green");
    expect(fatos.diffSemEspacos).not.toContain("red  ");
  });

  it("caminhos tocados desde a base incluem os do intervalo", async () => {
    const base = sh(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "novo.txt"), "x\n");
    await commitarCaminhos(repo, ["novo.txt"], "feat: novo");
    expect([...(await caminhosTocadosDesde(repo, base))]).toEqual(["novo.txt"]);
  });
});
