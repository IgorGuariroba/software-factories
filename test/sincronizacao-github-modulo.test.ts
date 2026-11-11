import { describe, expect, it, vi } from "vitest";
import {
  aplicarEntrega,
  type EntregaComId,
  type EstadoSincronizacao,
  JANELA_DE_SOBREPOSICAO_MS,
  MEMORIA_DE_ENTREGAS,
  type PortasSincronizacao,
  type ProjetoSincronizavel,
  reconciliar,
} from "../src/packages/sincronizacao-github/index.js";

// Sincronização com o GitHub com portas falsas: fixa que a primeira vez só grava linha de base, que depois a consulta
// usa a janela de sobreposição, que repositório desativado fica de fora, e que entrega repetida não muda nada.

const AGORA = Date.UTC(2026, 0, 10, 12, 0, 0);
type Snap = { numero: number };
type Entrega = EntregaComId & { tipo: string };

function projeto(
  nome: string,
  listar = vi.fn(async (_desde: string) => [] as Snap[]),
): ProjetoSincronizavel<Snap, string> {
  return { nome, configuracao: `cfg-${nome}`, listarMudancasDesde: listar };
}

function portasFalsas(
  estado: EstadoSincronizacao,
  projetos: ProjetoSincronizavel<Snap, string>[],
  sobrescritas: Partial<PortasSincronizacao<Snap, string, Entrega, string>> = {},
) {
  const efeitos: string[][] = [];
  const reconciliados: unknown[] = [];
  const portas: PortasSincronizacao<Snap, string, Entrega, string> = {
    agora: () => AGORA,
    projetos: () => projetos,
    estado: async () => estado,
    alterar: async (fn) => fn(estado),
    repoDesativado: () => false,
    reconciliar: vi.fn((_e, _p, snapshots) => {
      reconciliados.push(snapshots);
      return [] as Entrega[];
    }),
    aplicar: vi.fn((_e, entrega) => [`efeito-${entrega.deliveryId}`]),
    executarEfeitos: async (lote) => {
      efeitos.push(lote);
    },
    ...sobrescritas,
  };
  return { portas, efeitos, reconciliados };
}

describe("Sincronização: reconciliação", () => {
  it("sem sincronização anterior, só grava a linha de base e não consulta mudanças", async () => {
    const estado: EstadoSincronizacao = {};
    const listar = vi.fn(async () => [] as Snap[]);
    const { portas } = portasFalsas(estado, [projeto("sf", listar)]);
    await reconciliar(portas);
    expect(listar).not.toHaveBeenCalled();
    expect(estado.sincronizadoEm).toEqual({ sf: new Date(AGORA).toISOString() });
  });

  it("com sincronização anterior, consulta desde a anterior menos a janela de sobreposição", async () => {
    const anterior = "2026-01-10T11:00:00.000Z";
    const estado: EstadoSincronizacao = { sincronizadoEm: { sf: anterior } };
    const listar = vi.fn(async () => [] as Snap[]);
    const { portas } = portasFalsas(estado, [projeto("sf", listar)]);
    await reconciliar(portas);
    expect(listar).toHaveBeenCalledWith(new Date(Date.parse(anterior) - JANELA_DE_SOBREPOSICAO_MS).toISOString());
    expect(estado.sincronizadoEm?.sf).toBe(new Date(AGORA).toISOString());
  });

  it("as entregas reconciliadas são aplicadas uma a uma", async () => {
    const estado: EstadoSincronizacao = { sincronizadoEm: { sf: "2026-01-10T11:00:00.000Z" } };
    const entregas: Entrega[] = [
      { deliveryId: "d1", tipo: "issue" },
      { deliveryId: "d2", tipo: "issue" },
    ];
    const { portas, efeitos } = portasFalsas(
      estado,
      [
        projeto(
          "sf",
          vi.fn(async () => [{ numero: 1 }]),
        ),
      ],
      {
        reconciliar: () => entregas,
      },
    );
    await reconciliar(portas);
    expect(efeitos).toEqual([["efeito-d1"], ["efeito-d2"]]);
    expect(estado.deliveries).toEqual(["d1", "d2"]);
  });

  it("repositório desativado fica de fora: nem consulta nem muda a linha de base", async () => {
    const estado: EstadoSincronizacao = { sincronizadoEm: { sf: "x" } };
    const listar = vi.fn(async () => [] as Snap[]);
    const { portas } = portasFalsas(estado, [projeto("sf", listar)], { repoDesativado: () => true });
    await reconciliar(portas);
    expect(listar).not.toHaveBeenCalled();
    expect(estado.sincronizadoEm).toEqual({ sf: "x" });
  });
});

describe("Sincronização: entregas do webhook", () => {
  it("entrega nova é aplicada, registrada e tem seus efeitos executados", async () => {
    const estado: EstadoSincronizacao = {};
    const { portas, efeitos } = portasFalsas(estado, []);
    await aplicarEntrega(portas, { deliveryId: "g1", tipo: "issue" });
    expect(estado.deliveries).toEqual(["g1"]);
    expect(estado.ultimoWebhookEm).toBe(new Date(AGORA).toISOString());
    expect(efeitos).toEqual([["efeito-g1"]]);
  });

  it("reenvio de entrega já aplicada não muda o estado e não gera efeitos", async () => {
    const estado: EstadoSincronizacao = { deliveries: ["g1"] };
    const { portas, efeitos } = portasFalsas(estado, []);
    await aplicarEntrega(portas, { deliveryId: "g1", tipo: "issue" });
    expect(portas.aplicar).not.toHaveBeenCalled();
    expect(efeitos).toEqual([]);
    expect(estado.ultimoWebhookEm).toBeUndefined();
  });

  it("a memória de entregas guarda só as mais recentes", async () => {
    const antigas = Array.from({ length: MEMORIA_DE_ENTREGAS }, (_, i) => `v${i}`);
    const estado: EstadoSincronizacao = { deliveries: antigas };
    const { portas } = portasFalsas(estado, []);
    await aplicarEntrega(portas, { deliveryId: "nova", tipo: "issue" });
    expect(estado.deliveries).toHaveLength(MEMORIA_DE_ENTREGAS);
    expect(estado.deliveries?.at(-1)).toBe("nova");
    expect(estado.deliveries?.[0]).toBe("v1");
  });
});
