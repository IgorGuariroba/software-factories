import { describe, expect, it, vi } from "vitest";
import { ProjectConfig } from "../src/config.js";
import { comCalendarioEfetivo } from "../src/packages/configuracao-projeto/index.js";
import { branchRevisada, type EntradaBranch } from "../src/packages/tarefa/index.js";

// Branch revisada e aprovada: fixa cada motivo de recusa, o caminho feliz, a exigência de SPEC aprovada no mesmo ensaio, e
// que o git só é consultado quando a decisão ainda está em aberto. Também fixa o calendário efetivo do horário útil.

const base = (extra: Partial<EntradaBranch> = {}): EntradaBranch => ({
  cwd: "/wt/a",
  rascunho: { branch: "fab/a", base: "main" },
  progresso: { worktree: "/wt/a", branch: "fab/a", defaultBranch: "main", head: "h1" },
  revisao: { status: "aprovado", head: "h1" },
  exigeAprovacaoSpec: false,
  specRevisao: undefined,
  specAprovadaEmEnsaio: undefined,
  dryRun: false,
  caminhoReal: async () => "/wt/a",
  branchPadrao: vi.fn(async () => "main"),
  headDoCwd: vi.fn(async () => "h1"),
  ...extra,
});

describe("Branch revisada", () => {
  it("caminho feliz: branch, revisão aprovada, base e HEAD batem", async () => {
    expect(await branchRevisada(base())).toBe(true);
  });

  it("sem progresso da implementação, não é revisada", async () => {
    expect(await branchRevisada(base({ progresso: null }))).toBe(false);
  });

  it("worktree real diferente da pasta atual não é revisada", async () => {
    expect(await branchRevisada(base({ caminhoReal: async () => "/outro" }))).toBe(false);
  });

  it("branch diferente do rascunho não é revisada", async () => {
    expect(await branchRevisada(base({ progresso: { worktree: "/wt/a", branch: "outra", head: "h1" } }))).toBe(false);
  });

  it("revisão não aprovada não é revisada, e o git nem é consultado", async () => {
    const e = base({ revisao: { status: "corrigir", head: "h1" } });
    expect(await branchRevisada(e)).toBe(false);
    expect(e.headDoCwd).not.toHaveBeenCalled();
  });

  it("projeto que exige SPEC aprovada: sem aprovação, ou aprovada em outro modo de ensaio, não é revisada", async () => {
    expect(
      await branchRevisada(base({ exigeAprovacaoSpec: true, specRevisao: "draft", specAprovadaEmEnsaio: false })),
    ).toBe(false);
    expect(
      await branchRevisada(
        base({ exigeAprovacaoSpec: true, specRevisao: "approved", specAprovadaEmEnsaio: true, dryRun: false }),
      ),
    ).toBe(false);
    expect(
      await branchRevisada(
        base({ exigeAprovacaoSpec: true, specRevisao: "approved", specAprovadaEmEnsaio: false, dryRun: false }),
      ),
    ).toBe(true);
  });

  it("base do rascunho diferente da branch padrão não é revisada", async () => {
    expect(await branchRevisada(base({ rascunho: { branch: "fab/a", base: "develop" } }))).toBe(false);
  });

  it("sem branch padrão registrada no progresso, consulta a do repositório", async () => {
    const branchPadrao = vi.fn(async () => "trunk");
    expect(
      await branchRevisada(
        base({
          progresso: { worktree: "/wt/a", branch: "fab/a", defaultBranch: null, head: "h1" },
          rascunho: { branch: "fab/a", base: "trunk" },
          branchPadrao,
        }),
      ),
    ).toBe(true);
    expect(branchPadrao).toHaveBeenCalledWith("/wt/a");
  });

  it("HEAD local diferente do aprovado não é revisada", async () => {
    expect(await branchRevisada(base({ headDoCwd: async () => "h2" }))).toBe(false);
  });
});

describe("Calendário efetivo", () => {
  const cfg = (activity: "business-hours" | "always") =>
    ProjectConfig.parse({
      name: "sf",
      source: {
        type: "github",
        project: "SF",
        repo: "dono/sf",
        assignee: "dono",
        triageApproval: true,
        maxActive: 3,
        ignoreLabels: [],
      },
      roles: { spec: { provider: "openai", model: "gpt" }, reviewer: { provider: "openrouter", model: "claude" } },
      statuses: { aberta: "todo", fechada: "done" },
      activity,
    });

  it("horário útil sempre usa feriados legais", () => {
    expect(comCalendarioEfetivo(cfg("business-hours")).calendar.legalHolidays).toBe(true);
  });

  it("demais modos mantêm a configuração como está", () => {
    const c = cfg("always");
    expect(comCalendarioEfetivo(c)).toBe(c);
  });
});
