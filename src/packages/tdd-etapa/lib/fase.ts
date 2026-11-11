import type { FaseTdd } from "./passos.js";

/**
 * Arquivos que a fase não pode tocar. A fase de teste só mexe em arquivos de teste; a de implementação não mexe neles. O que
 * está fora da fase é devolvido, para o descarte.
 */
export function arquivosForaDaFase(
  caminhos: readonly string[],
  ehTeste: (caminho: string) => boolean,
  fase: FaseTdd,
): string[] {
  return caminhos.filter((p) => ehTeste(p) !== (fase === "teste"));
}

/** A regra da fase, em palavras, para a mensagem de recusa. */
export function regraDaFase(fase: FaseTdd, padroesDeTeste: readonly string[]): string {
  return fase === "teste"
    ? `na fase de teste só arquivos de teste podem mudar (padrões: ${padroesDeTeste.join(", ")})`
    : "na fase de implementação os arquivos de teste não podem mudar nem ser apagados";
}

/** Resultado da suíte, como a fase o julga. */
export interface ExecucaoSuite {
  timedOut: boolean;
  exitCode: number | null;
}

/**
 * O que a suíte diz sobre a fase. Estouro de tempo e sinal vencem; depois, a fase de teste exige que o teste novo falhe e a
 * de implementação exige que a suíte passe.
 */
export function julgamentoDaSuite(
  fase: FaseTdd,
  execucao: ExecucaoSuite,
): "ok" | "estourou" | "sinal" | "passou-na-fase-de-teste" | "falhou-na-implementacao" {
  if (execucao.timedOut) return "estourou";
  if (execucao.exitCode === null) return "sinal";
  if (fase === "teste" && execucao.exitCode === 0) return "passou-na-fase-de-teste";
  if (fase === "implementacao" && execucao.exitCode !== 0) return "falhou-na-implementacao";
  return "ok";
}
