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
      /** Uma pergunta a uma pessoa do projeto: enviada, lembrada ou respondida. */
      type: "question";
      at: string;
      project: string;
      /** Card da Tarefa. */
      target: string;
      /** Número da pergunta na Tarefa (1, 2, …). */
      n: number;
      /** Pessoa do projeto a quem a pergunta foi feita. */
      to: string;
      text: string;
      status: "enviada" | "lembrete" | "respondida" | "encaminhar";
    }
  | {
      /**
       * Aviso ao usuário, para as interfaces de gestão encaminharem (ex.: uma pergunta sem resposta há 1 dia útil ou
       * o prazo de veto de um card que já estava em andamento).
       * Não vai para o card nem para as pessoas do projeto.
       */
      type: "notify";
      at: string;
      project: string;
      target: string;
      reason: "pergunta-sem-resposta" | "aguardando-veto" | "sugestao-repo-time" | "retro-pronta" | "triagem";
      message: string;
      /** Até quando o usuário pode agir (ex.: o fim do prazo de veto), em ISO 8601. */
      until?: string;
    }
  | {
      /** A fábrica assumiu o card (comentário de assunção feito ou, no dry-run, registrado). Uma vez por Tarefa. */
      type: "assumed";
      at: string;
      project: string;
      target: string;
      title: string;
      /** O card já estava em andamento: o aviso de prazo de veto (`notify`) vem logo depois. */
      waitsVeto: boolean;
    }
  | {
      /** Um comando recebido por uma interface de gestão: executado, ou ignorado por vir de origem não autorizada. */
      type: "command";
      at: string;
      /** Interface de gestão (ex.: `telegram`). */
      via: string;
      chat: string;
      user: string;
      text: string;
      accepted: boolean;
      /** O que a fábrica fez (a resposta ao usuário) ou por que ignorou. */
      result: string;
    }
  | {
      /** Uma mensagem a uma interface de gestão que não saiu depois de todas as tentativas e foi descartada. */
      type: "delivery";
      at: string;
      via: string;
      status: "descartada";
      attempts: number;
      text: string;
      error: string;
    }
  | {
      /** Passo de trabalho da fábrica numa Tarefa (commit TDD, review, publicação), para acompanhar ao vivo. */
      type: "progress";
      at: string;
      project: string;
      target: string;
      message: string;
    }
  | {
      /** Uma retrô terminou (`concluida`) ou desistiu depois das tentativas (`falhou`), sem bloquear a Tarefa. */
      type: "retro";
      at: string;
      project: string;
      /** Card da Tarefa. */
      target: string;
      stage: "triagem" | "spec" | "implementacao" | "review" | "mr" | "tarefa";
      status: "concluida" | "falhou";
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
