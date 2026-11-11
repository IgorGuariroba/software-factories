import { describe, expect, it, vi } from "vitest";
import {
  type EstadoTriagem,
  type PortasTriagem,
  type RegistroTriagem,
  type TarefaTriagem,
  triagemDaTarefa,
} from "../src/packages/triagem/index.js";
import type { TriageResult } from "../src/triage.js";

// Triagem com portas falsas: fixa o desfecho (aceitar, adiar por falta de vaga, recusar, pedir decisão da pessoa),
// a reserva de vaga e a retomada de uma decisão já registrada. Sem Fonte, sem modelo, sem fábrica.

const resultado = (verdict: TriageResult["verdict"], extra: Partial<TriageResult> = {}): TriageResult =>
  ({ verdict, category: "outro", reason: "motivo interno", by: "regra", ...extra }) as TriageResult;

function tarefa(extra: Partial<TarefaTriagem> = {}): TarefaTriagem {
  return { id: "p/K-1", project: "p", status: "em-triagem", stage: "triagem", ...extra };
}

function portasFalsas(
  estado: EstadoTriagem,
  opcoes: { triageApproval?: boolean; maxActive?: number; github?: boolean; resultado?: TriageResult } = {},
) {
  const fechadas: unknown[] = [];
  const avisos: string[] = [];
  const avaliar = vi.fn(async () => opcoes.resultado ?? resultado("aceita"));
  const portas: PortasTriagem = {
    alterar: async (fn) => fn(estado),
    configuracao: () =>
      opcoes.github === false
        ? undefined
        : { triageApproval: opcoes.triageApproval ?? false, maxActive: opcoes.maxActive ?? 2 },
    avaliar,
    fecharRecusada: async (projeto, chave, comentario, motivo) => {
      fechadas.push({ projeto, chave, comentario, motivo });
    },
    avisarDuvida: async (_projeto, _chave, mensagem) => {
      avisos.push(mensagem);
    },
  };
  return { portas, avaliar, fechadas, avisos };
}

const alvo = { id: "p/K-1", project: "p", key: "K-1" };

describe("Triagem: desfechos", () => {
  it("projeto que não é de repositório monitorado não tem o que triar", async () => {
    const estado: EstadoTriagem = { tasks: [tarefa()] };
    const { portas, avaliar } = portasFalsas(estado, { github: false });
    expect(await triagemDaTarefa(portas, alvo)).toBeUndefined();
    expect(avaliar).not.toHaveBeenCalled();
  });

  it("aceita com vaga: segue, reserva a vaga (etapa assumir) e grava o registro", async () => {
    const estado: EstadoTriagem = { tasks: [tarefa()] };
    const { portas } = portasFalsas(estado, { resultado: resultado("aceita") });
    expect(await triagemDaTarefa(portas, alvo)).toBeUndefined();
    expect(estado.tasks[0].stage).toBe("assumir");
    expect(estado.tasks[0].triage).toEqual({ result: resultado("aceita"), review: null });
  });

  it("aceita sem vaga: adia e não reserva nada", async () => {
    const estado: EstadoTriagem = {
      tasks: [
        tarefa(),
        tarefa({ id: "p/K-2", status: "enfileirada", stage: "implementacao" }),
        tarefa({ id: "p/K-3", status: "enfileirada", stage: "spec" }),
      ],
    };
    const { portas } = portasFalsas(estado, { maxActive: 2, resultado: resultado("aceita") });
    expect(await triagemDaTarefa(portas, alvo)).toBe("adiar");
    expect(estado.tasks[0].stage).toBe("triagem");
  });

  it("Tarefa terminada e Tarefas ainda na triagem não ocupam vaga", async () => {
    const estado: EstadoTriagem = {
      tasks: [
        tarefa(),
        tarefa({ id: "p/K-2", status: "concluida", stage: "entrega" }),
        tarefa({ id: "p/K-3", status: "em-triagem", stage: "triagem" }),
        tarefa({ id: "p/OUTRO-1", project: "outro", status: "enfileirada", stage: "spec" }),
      ],
    };
    const { portas } = portasFalsas(estado, { maxActive: 1, resultado: resultado("aceita") });
    expect(await triagemDaTarefa(portas, alvo)).toBeUndefined();
    expect(estado.tasks[0].stage).toBe("assumir");
  });

  it("recusa sem aprovação prévia: comenta e dá baixa com o motivo de fechamento", async () => {
    const estado: EstadoTriagem = { tasks: [tarefa()] };
    const duplicada = resultado("recusa", { category: "duplicata", duplicateOf: "K-9" } as Partial<TriageResult>);
    const { portas, fechadas } = portasFalsas(estado, { resultado: duplicada });
    expect(await triagemDaTarefa(portas, alvo)).toBe("recusada");
    expect(fechadas).toEqual([
      expect.objectContaining({
        projeto: "p",
        chave: "K-1",
        motivo: "duplicate",
        comentario: expect.stringContaining("#9"),
      }),
    ]);
  });

  it("recusa com triageApproval: não fecha; pede a decisão da pessoa com rascunho", async () => {
    const estado: EstadoTriagem = { tasks: [tarefa()] };
    const { portas, fechadas, avisos } = portasFalsas(estado, {
      triageApproval: true,
      resultado: resultado("recusa"),
    });
    expect(await triagemDaTarefa(portas, alvo)).toBe("aguardar");
    expect(fechadas).toEqual([]);
    expect(estado.tasks[0].triage?.review).toBe("draft");
    expect(avisos).toEqual([expect.stringContaining("propõe recusar")]);
  });

  it("dúvida: aguarda a pessoa e avisa que ficou em dúvida", async () => {
    const estado: EstadoTriagem = { tasks: [tarefa()] };
    const { portas, avisos } = portasFalsas(estado, { resultado: resultado("duvidosa") });
    expect(await triagemDaTarefa(portas, alvo)).toBe("aguardar");
    expect(avisos).toEqual([expect.stringContaining("ficou em dúvida")]);
  });

  it("rascunho já registrado: aguarda sem avaliar de novo nem avisar de novo", async () => {
    const registro: RegistroTriagem = { result: resultado("duvidosa"), review: "draft" };
    const estado: EstadoTriagem = { tasks: [tarefa({ triage: registro })] };
    const { portas, avaliar, avisos } = portasFalsas(estado);
    expect(await triagemDaTarefa(portas, alvo)).toBe("aguardar");
    expect(avaliar).not.toHaveBeenCalled();
    expect(avisos).toEqual([]);
  });

  it("decisão da pessoa registrada (recusar) é cumprida sem nova avaliação", async () => {
    const registro: RegistroTriagem = { result: resultado("recusa"), review: "recusar" };
    const estado: EstadoTriagem = { tasks: [tarefa({ triage: registro })] };
    const { portas, avaliar, fechadas } = portasFalsas(estado, { triageApproval: true });
    expect(await triagemDaTarefa(portas, alvo)).toBe("recusada");
    expect(avaliar).not.toHaveBeenCalled();
    expect(fechadas).toHaveLength(1);
  });
});
