/** Desfecho de uma etapa para o runtime durável: aguardar uma pessoa, encerrar, adiar, ou seguir. */
export type DesfechoEtapa = "aguardar" | "recusada" | "adiar" | "acompanhar" | undefined;

/** Entrega da SPEC: a especificação e os tickets que a implementação vai seguir. */
export interface EntregaSpec {
  spec: string;
  tickets: unknown[];
}

/**
 * Portas da execução de uma etapa. A ordem das etapas e o que cada uma faz com o resultado são regras do módulo; o que
 * cada porta faz (Fonte, modelo, estado, canal) fica com a fábrica.
 */
export interface PortasExecucao {
  triar(): Promise<"aguardar" | "recusada" | "adiar" | undefined>;
  /** Comenta "assumindo" no card, se o projeto pede. */
  anunciarAssumido(): Promise<void>;
  /** O aviso de "assumindo" já saiu para este card? */
  jaAnunciouAssumido(): boolean;
  /** Registra o evento de "assumido" da Tarefa. */
  registrarAssumido(): Promise<void>;
  transicionar(): Promise<void>;
  /** Qual etapa de retrô este passo representa, se é um passo de retrô. */
  etapaDeRetro(passo: string): "triagem" | "spec" | "implementacao" | "review" | "mr" | "tarefa" | undefined;
  retro(etapa: "triagem" | "spec" | "implementacao" | "review" | "mr" | "tarefa"): Promise<void>;
  revisar(): Promise<void>;
  /** Entrega em lotes, com revisão do feedback: o desfecho que a etapa devolve (`acompanhar`, ou nada). */
  entregar(): Promise<"acompanhar" | undefined>;
  /** Escolhe o repositório e implementa. `aguardar` se a escolha depende de uma pergunta ainda sem resposta. */
  implementar(): Promise<"aguardar" | undefined>;
  /** A entrega da SPEC já existe nesta Tarefa (uma tentativa anterior a obteve)? */
  entregaDaSpec(): Promise<EntregaSpec | undefined>;
  /** Conduz a SPEC (grill → SPEC): a entrega, ou `aguardar`. */
  especificar(): Promise<EntregaSpec | "aguardar">;
  /** A SPEC exige aprovação neste projeto? */
  exigeAprovacaoSpec(): boolean;
  /** A aprovação da SPEC vale para o modo atual? Se não, a SPEC volta a rascunho. */
  aprovacaoSpecVigente(): Promise<boolean>;
  /** Publica a SPEC e os tickets nos comentários do card. */
  publicarSpec(entrega: EntregaSpec): Promise<void>;
}

/**
 * Executa um passo da Tarefa. Os passos de fluxo são triagem, anúncio, transição, retrô, revisão e entrega; o que não é
 * um deles é a SPEC: reaproveita a entrega de uma tentativa anterior, ou especifica; exige aprovação quando o projeto pede;
 * e publica.
 */
export async function executarEtapa(portas: PortasExecucao, passo: string): Promise<DesfechoEtapa> {
  if (passo === "triar") return portas.triar();
  if (passo === "comentar") {
    await portas.anunciarAssumido();
    // Uma nova tentativa recomeça deste passo; o aviso de que assumiu sai uma vez só.
    if (!portas.jaAnunciouAssumido()) await portas.registrarAssumido();
    return undefined;
  }
  if (passo === "transicionar") {
    await portas.transicionar();
    return undefined;
  }
  const etapaDeRetro = portas.etapaDeRetro(passo);
  if (etapaDeRetro) {
    await portas.retro(etapaDeRetro);
    return undefined;
  }
  if (passo === "revisar") {
    await portas.revisar();
    return undefined;
  }
  if (passo === "entregar") return portas.entregar();
  if (passo === "implementar") return portas.implementar();

  let entrega = await portas.entregaDaSpec();
  if (!entrega) {
    const especificada = await portas.especificar();
    if (especificada === "aguardar") return "aguardar";
    entrega = especificada;
  }
  if (portas.exigeAprovacaoSpec() && !(await portas.aprovacaoSpecVigente())) return "aguardar";
  await portas.publicarSpec(entrega);
  return undefined;
}
