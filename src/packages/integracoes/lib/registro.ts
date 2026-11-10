/** Um registro de integrações de um mesmo papel (Fontes, Canais): tipo → fábrica. */
export interface Registro<Config, Integracao> {
  /** Registra a fábrica do `tipo`. Registrar o mesmo tipo duas vezes é erro. */
  register(tipo: string, fabrica: (config: Config) => Integracao): void;
  /** Cria a integração do `tipo` com a configuração dada. Tipo não registrado é erro. */
  create(tipo: string, config: Config): Integracao;
  /** Se o `tipo` está registrado. */
  tem(tipo: string): boolean;
  /** Tipos registrados, na ordem de registro. */
  tipos(): string[];
}

export function createIntegrationRegistry<Config, Integracao>(nome: string): Registro<Config, Integracao> {
  const fabricas = new Map<string, (config: Config) => Integracao>();
  return {
    register(tipo, fabrica) {
      if (fabricas.has(tipo)) throw new Error(`${nome} "${tipo}" já está registrada`);
      fabricas.set(tipo, fabrica);
    },
    create(tipo, config) {
      const fabrica = fabricas.get(tipo);
      if (!fabrica) throw new Error(`${nome} "${tipo}" não disponível`);
      return fabrica(config);
    },
    tem: (tipo) => fabricas.has(tipo),
    tipos: () => [...fabricas.keys()],
  };
}
