import { describe, expect, it, vi } from "vitest";
import { type EntregaSpec, executarEtapa, type PortasExecucao } from "../src/packages/tarefa/index.js";

// Despacho das etapas da Tarefa com portas falsas: fixa quais portas cada passo chama, que o aviso de "assumindo" sai uma
// vez só, que a SPEC reaproveita a entrega de uma tentativa anterior, e que a aprovação vigente segura a publicação.

const entrega: EntregaSpec = { spec: "SPEC", tickets: [{ titulo: "t" }] };

function portasFalsas(sobrescritas: Partial<PortasExecucao> = {}) {
  const chamadas: string[] = [];
  const registra = (nome: string) =>
    vi.fn(async () => {
      chamadas.push(nome);
      return undefined as never;
    });
  const portas: PortasExecucao = {
    triar: registra("triar") as never,
    anunciarAssumido: registra("anunciar") as never,
    jaAnunciouAssumido: () => false,
    registrarAssumido: registra("registrarAssumido") as never,
    transicionar: registra("transicionar") as never,
    etapaDeRetro: (passo) => (passo === "retro-spec" ? "spec" : undefined),
    retro: registra("retro") as never,
    revisar: registra("revisar") as never,
    entregar: (async () => {
      chamadas.push("entregar");
      return "acompanhar" as const;
    }) as never,
    implementar: (async () => {
      chamadas.push("implementar");
      return undefined;
    }) as never,
    entregaDaSpec: async () => undefined,
    especificar: (async () => {
      chamadas.push("especificar");
      return entrega;
    }) as never,
    exigeAprovacaoSpec: () => false,
    aprovacaoSpecVigente: (async () => {
      chamadas.push("vigente");
      return true;
    }) as never,
    publicarSpec: (async () => {
      chamadas.push("publicar");
    }) as never,
    ...sobrescritas,
  };
  return { portas, chamadas };
}

describe("Etapa: passos de fluxo", () => {
  it("triagem devolve o desfecho da triagem", async () => {
    const { portas, chamadas } = portasFalsas({ triar: (async () => "adiar") as never });
    expect(await executarEtapa(portas, "triar")).toBe("adiar");
    expect(chamadas).toEqual([]);
  });

  it("transicionar, revisar e retro não devolvem desfecho", async () => {
    const { portas, chamadas } = portasFalsas();
    expect(await executarEtapa(portas, "transicionar")).toBeUndefined();
    expect(await executarEtapa(portas, "revisar")).toBeUndefined();
    expect(await executarEtapa(portas, "retro-spec")).toBeUndefined();
    expect(chamadas).toEqual(["transicionar", "revisar", "retro"]);
  });

  it("entregar devolve o desfecho da entrega", async () => {
    const { portas } = portasFalsas();
    expect(await executarEtapa(portas, "entregar")).toBe("acompanhar");
  });

  it("implementar devolve o que a escolha de repositório decidiu", async () => {
    const { portas } = portasFalsas({ implementar: (async () => "aguardar") as never });
    expect(await executarEtapa(portas, "implementar")).toBe("aguardar");
  });
});

describe("Etapa: anúncio de assumido", () => {
  it("anuncia e registra quando ainda não anunciou", async () => {
    const { portas, chamadas } = portasFalsas();
    await executarEtapa(portas, "comentar");
    expect(chamadas).toEqual(["anunciar", "registrarAssumido"]);
  });

  it("não registra de novo quando já anunciou", async () => {
    const { portas, chamadas } = portasFalsas({ jaAnunciouAssumido: () => true });
    await executarEtapa(portas, "comentar");
    expect(chamadas).toEqual(["anunciar"]);
  });
});

describe("Etapa: SPEC", () => {
  it("sem entrega anterior, especifica e publica", async () => {
    const { portas, chamadas } = portasFalsas();
    expect(await executarEtapa(portas, "spec")).toBeUndefined();
    expect(chamadas).toEqual(["especificar", "publicar"]);
  });

  it("reaproveita a entrega de uma tentativa anterior, sem especificar de novo", async () => {
    const { portas, chamadas } = portasFalsas({ entregaDaSpec: async () => entrega });
    await executarEtapa(portas, "spec");
    expect(chamadas).toEqual(["publicar"]);
  });

  it("especificação que espera uma pessoa devolve aguardar e não publica", async () => {
    const { portas, chamadas } = portasFalsas({ especificar: (async () => "aguardar") as never });
    expect(await executarEtapa(portas, "spec")).toBe("aguardar");
    expect(chamadas).toEqual([]);
  });

  it("projeto que exige aprovação só publica com aprovação vigente", async () => {
    const { portas, chamadas } = portasFalsas({
      exigeAprovacaoSpec: () => true,
      aprovacaoSpecVigente: (async () => false) as never,
    });
    expect(await executarEtapa(portas, "spec")).toBe("aguardar");
    expect(chamadas).toEqual(["especificar"]);
  });

  it("com aprovação vigente, publica", async () => {
    const { portas, chamadas } = portasFalsas({ exigeAprovacaoSpec: () => true });
    await executarEtapa(portas, "spec");
    expect(chamadas).toEqual(["especificar", "vigente", "publicar"]);
  });
});
