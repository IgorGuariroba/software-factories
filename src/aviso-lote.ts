/** Motivos de aviso ao usuário que a fábrica agrupa numa rajada. */
export type MotivoAviso = "escopo-alterado" | "repositorio-desvinculado" | "repo-sem-projeto";

/** Aviso ao usuário já pronto para o log de eventos. */
export interface AvisoEmitido {
  type: "notificar";
  project: string;
  target: string;
  reason: MotivoAviso;
  message: string;
}

/** Quanto um lote pode esperar: se os avisos não param de chegar, sai mesmo assim depois deste tempo. */
const MAX_ESPERA_MS = 60_000;

/**
 * Agrupa avisos de uma rajada (ex.: 16 issues fechadas em sequência, cada uma com seu webhook) em um resumo por projeto
 * e motivo. Um aviso sozinho sai como veio. A saída acontece quando a rajada para por `janelaMs` ou quando o lote
 * completa `MAX_ESPERA_MS`. Com `janelaMs` 0, nada é agrupado.
 */
export class AvisoLote {
  private pendentes: AvisoEmitido[] = [];
  private primeiroEm = 0;
  private desarmar?: () => void;

  constructor(
    private readonly opts: {
      janelaMs: number;
      now: () => number;
      armTimer: (callback: () => void, delayMs: number) => (() => void) | undefined;
      emit: (aviso: AvisoEmitido) => Promise<void>;
    },
  ) {}

  async add(aviso: AvisoEmitido): Promise<void> {
    if (this.opts.janelaMs <= 0) return this.opts.emit(aviso);
    if (this.pendentes.length === 0) this.primeiroEm = this.opts.now();
    this.pendentes.push(aviso);
    if (this.opts.now() - this.primeiroEm >= MAX_ESPERA_MS) return this.flush();
    this.desarmar?.();
    this.desarmar = this.opts.armTimer(() => {
      this.flush().catch((err) => console.error("[fábrica] aviso em lote falhou:", err));
    }, this.opts.janelaMs);
  }

  /** Emite tudo o que está pendente, um aviso por grupo (projeto e motivo). */
  async flush(): Promise<void> {
    this.desarmar?.();
    this.desarmar = undefined;
    const lote = this.pendentes;
    this.pendentes = [];
    const grupos = new Map<string, AvisoEmitido[]>();
    for (const aviso of lote) {
      const chave = `${aviso.project}\u0000${aviso.reason}`;
      grupos.set(chave, [...(grupos.get(chave) ?? []), aviso]);
    }
    for (const grupo of grupos.values()) {
      await this.opts.emit(grupo.length === 1 ? (grupo[0] as AvisoEmitido) : resumo(grupo));
    }
  }
}

function resumo(grupo: AvisoEmitido[]): AvisoEmitido {
  const primeiro = grupo[0] as AvisoEmitido;
  const alvos = grupo.map((a) => a.target);
  const mostrados = alvos.slice(0, 10).join(", ");
  const resto = alvos.length > 10 ? ` e mais ${alvos.length - 10}` : "";
  return {
    type: "notificar",
    project: primeiro.project,
    target: `${grupo.length} cards`,
    reason: primeiro.reason,
    message: `${grupo.length} avisos de ${primeiro.reason} em ${primeiro.project}: ${mostrados}${resto}.`,
  };
}
