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
    }
  | {
      /** Falha inesperada (ex.: Fonte fora do ar); a tarefa volta para a fila. */
      type: "error";
      at: string;
      project: string;
      target: string;
      message: string;
    }
  | {
      /** Mudança de status de uma tarefa. */
      type: "task";
      at: string;
      project: string;
      id: string;
      key: string;
      status: string;
      reason?: string;
    };

export type NewEvent = FactoryEvent extends infer E ? (E extends FactoryEvent ? Omit<E, "at"> : never) : never;

/** Onde os eventos são registrados. */
export interface EventRecorder {
  append(event: NewEvent): void | Promise<void>;
  list(): FactoryEvent[];
}

/** Log de eventos só em memória (usado em testes de módulos isolados). */
export class EventLog implements EventRecorder {
  private events: FactoryEvent[] = [];

  constructor(private now: () => Date = () => new Date()) {}

  append(event: NewEvent): void {
    this.events.push({ ...event, at: this.now().toISOString() } as FactoryEvent);
  }

  list(): FactoryEvent[] {
    return [...this.events];
  }
}
