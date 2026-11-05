/** Algo que a fábrica fez ou deixou de fazer, para auditoria e para as interfaces de gestão. */
export type FactoryEvent =
  | {
      type: "write";
      at: string;
      project: string;
      /** Onde a escrita acontece (ex.: chave do card). */
      target: string;
      action: string;
      content: string;
      dryRun: boolean;
    }
  | {
      type: "blocked";
      at: string;
      project: string;
      target: string;
      action: string;
      content: string;
      /** Por que o guardrail bloqueou a escrita. */
      reason: string;
    };

export type NewEvent = FactoryEvent extends infer E ? (E extends FactoryEvent ? Omit<E, "at"> : never) : never;

/** Log de eventos em memória. A persistência chega com a tarefa durável (M1-04). */
export class EventLog {
  private events: FactoryEvent[] = [];

  constructor(private now: () => Date = () => new Date()) {}

  append(event: NewEvent): void {
    this.events.push({ ...event, at: this.now().toISOString() } as FactoryEvent);
  }

  list(): FactoryEvent[] {
    return [...this.events];
  }
}
