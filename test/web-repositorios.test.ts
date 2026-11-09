import { describe, expect, it } from "vitest";
import { linhasRepositorios, mensagemTarefasAtivas } from "../web/repositorios.js";

const ativo = {
  project: "exemplo",
  repo: "dono/app",
  status: "ativo" as const,
  installationId: null,
  motivo: null,
};

const desativado = {
  project: "outro",
  repo: "dono/api",
  status: "desativado" as const,
  installationId: 42,
  motivo: "repositório removido da instalação do App",
};

describe("linhasRepositorios: o que a tela mostra para cada repositório", () => {
  it("repositório ativo oferece desplugar e não mostra motivo", () => {
    const [linha] = linhasRepositorios([ativo]);
    expect(linha).toMatchObject({
      projeto: "exemplo",
      repositorio: "dono/app",
      estado: "Ativo",
      acao: "desplugar",
      motivo: "",
      origem: "configurado no YAML",
    });
  });

  it("repositório desativado oferece plugar e mostra o motivo e a instalação de origem", () => {
    const [linha] = linhasRepositorios([desativado]);
    expect(linha).toMatchObject({
      estado: "Desativado",
      acao: "plugar",
      motivo: "repositório removido da instalação do App",
      origem: "instalação 42",
    });
  });

  it("sem repositórios, a lista vem vazia", () => {
    expect(linhasRepositorios([])).toEqual([]);
  });
});

describe("mensagemTarefasAtivas: o aviso antes de desplugar com Tarefa em execução", () => {
  it("nomeia as Tarefas em execução e diz que desplugar as cancela", () => {
    const texto = mensagemTarefasAtivas(["exemplo/SF-7"]);
    expect(texto).toContain("exemplo/SF-7");
    expect(texto).toMatch(/cancel/);
  });

  it("usa o plural quando há mais de uma", () => {
    const texto = mensagemTarefasAtivas(["exemplo/SF-7", "exemplo/SF-8"]);
    expect(texto).toMatch(/2 Tarefas/);
    expect(texto).toContain("exemplo/SF-8");
  });
});
