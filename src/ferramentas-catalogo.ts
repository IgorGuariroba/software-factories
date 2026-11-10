/**
 * Catálogo fechado das ferramentas que um Agente da etapa pode usar. A configuração escolhe um subconjunto destes
 * nomes; nunca cria uma ferramenta nova. Cada ferramenta mantém os guardrails do adaptador que a executa.
 */

export type TipoFerramenta = "leitura" | "escrita" | "execucao" | "entrega" | "pergunta";

export const FERRAMENTAS = {
  ler_arquivo: { tipo: "leitura" },
  escrever_arquivo: { tipo: "escrita" },
  rodar_testes: { tipo: "execucao" },
  executar_comando: { tipo: "execucao" },
  ler_contexto_review: { tipo: "leitura" },
  entregar_review: { tipo: "entrega" },
  entregar_spec: { tipo: "entrega" },
  perguntar_po: { tipo: "pergunta" },
  perguntar_tecnico: { tipo: "pergunta" },
  entregar_retro: { tipo: "entrega" },
} as const satisfies Record<string, { readonly tipo: TipoFerramenta }>;

export type NomeFerramenta = keyof typeof FERRAMENTAS;

/** Ferramentas que cada etapa usa hoje. A configuração por etapa (ticket 02) parte destes valores como padrão. */
export const FERRAMENTAS_DA_ETAPA = {
  spec: ["entregar_spec", "perguntar_po", "perguntar_tecnico"],
  review: ["ler_contexto_review", "entregar_review"],
  implementacao: ["ler_arquivo", "escrever_arquivo", "rodar_testes"],
  retro: ["entregar_retro"],
} as const satisfies Record<string, readonly NomeFerramenta[]>;

/**
 * Ferramentas que cada etapa implementa de fato. Uma ferramenta disponível pode ficar desligada no padrão: o bash
 * (`executar_comando`) só é oferecido à implementação quando a configuração liga (fatia 08).
 */
export const DISPONIVEIS_DA_ETAPA = {
  spec: FERRAMENTAS_DA_ETAPA.spec,
  review: FERRAMENTAS_DA_ETAPA.review,
  implementacao: [...FERRAMENTAS_DA_ETAPA.implementacao, "executar_comando"],
  retro: FERRAMENTAS_DA_ETAPA.retro,
} as const satisfies Record<string, readonly NomeFerramenta[]>;

export type EtapaComFerramentas = keyof typeof FERRAMENTAS_DA_ETAPA;

export function tipoDaFerramenta(nome: NomeFerramenta): TipoFerramenta {
  return FERRAMENTAS[nome].tipo;
}

/** Recusa qualquer nome que não esteja no catálogo. Devolve os nomes validados, na mesma ordem. */
export function validarFerramentas(nomes: readonly string[]): NomeFerramenta[] {
  return nomes.map((nome) => {
    if (!Object.hasOwn(FERRAMENTAS, nome)) throw new Error(`ferramenta fora do catálogo: ${nome}`);
    return nome as NomeFerramenta;
  });
}

/**
 * O catálogo para a interface: cada ferramenta, o tipo, as etapas que a implementam (`etapas`) e as que a têm ligada
 * por padrão (`etapasPadrao`). A diferença entre as duas listas é o que a configuração pode ligar.
 */
export function catalogoDeFerramentas(): {
  nome: NomeFerramenta;
  tipo: TipoFerramenta;
  etapas: EtapaComFerramentas[];
  etapasPadrao: EtapaComFerramentas[];
}[] {
  const etapas = Object.keys(DISPONIVEIS_DA_ETAPA) as EtapaComFerramentas[];
  return (Object.keys(FERRAMENTAS) as NomeFerramenta[]).map((nome) => ({
    nome,
    tipo: FERRAMENTAS[nome].tipo,
    etapas: etapas.filter((e) => (DISPONIVEIS_DA_ETAPA[e] as readonly string[]).includes(nome)),
    etapasPadrao: etapas.filter((e) => (FERRAMENTAS_DA_ETAPA[e] as readonly string[]).includes(nome)),
  }));
}
