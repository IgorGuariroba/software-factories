import { type ConversationId, defineDoc, defineEntry, type JsonObject } from "@earendil-works/pi-durable";
import type { QuestionRef } from "./channel.js";
import type { CardState, FormatCommand, TestCommand } from "./config.js";
import type { EncaminhamentoTecnico } from "./encaminhamento-tecnico.js";
import type { FactoryEvent } from "./events.js";
import type { SpecDelivery } from "./spec-stage.js";
import type { TriageResult } from "./triage.js";

// Modelo de estado da fábrica: a fila de Tarefas, os docs duráveis (estado e progresso das interfaces de gestão) e o
// transcript de eventos. O runtime das Tarefas (passos, portões, tasks) fica em durable.ts, que reexporta tudo isto.

/** Status de uma Tarefa na fila. */
export type TaskStatus =
  | "enfileirada"
  | "ativa"
  | "aguardando-humano"
  | "aguardando-veto"
  | "aguardando-entrega"
  | "pausada"
  | "concluida"
  | "cancelada"
  | "bloqueada"
  | "vetada"
  /** A triagem recusou a issue e a fábrica deu baixa nela. */
  | "recusada";

/** Prazo de veto de uma Tarefa cujo card já estava em andamento quando a fábrica o assumiu. */
export type VetoWindow = {
  /** Fim do prazo (ms, no relógio da fábrica). Um veto a partir daqui não vale mais. */
  until: number;
  /** O prazo venceu sem veto: a Tarefa segue para as etapas. */
  expired: boolean;
};

/** Uma pergunta de negócio da Tarefa ao PO, com os prazos de escalonamento já calculados em horas úteis. */
export type Question = {
  /** Número da pergunta na Tarefa (1, 2, …). */
  n: number;
  /** Quem levantou a pergunta: o grill ou a própria fábrica, diante de um card vazio ou raso. */
  origin: "grill" | "card-raso" | "tecnica";
  /** Decisão estruturada que esta pergunta técnica aguarda. */
  purpose?: "repositorio";
  /** Pessoa do projeto a quem foi feita. */
  to: string;
  text: string;
  /** Onde o Canal fez a pergunta. */
  ref: QuestionRef;
  askedAt: number;
  /** Lembrete à pessoa (4 h úteis depois da pergunta). */
  remindAt: number;
  /** Aviso ao usuário (1 dia útil depois da pergunta). */
  notifyAt: number;
  reminded: boolean;
  notified: boolean;
  answer: string | null;
  /** Resposta não resolutiva do usuário, preservada para encaminhar ao tech lead. */
  userResponse?: string;
  needsForwarding?: boolean;
  /** Reserva e resultado do envio ao tech lead, compartilhados pelos dois gatilhos. */
  forwarding?: EncaminhamentoTecnico;
  /** Rascunho de ensaio; `sending` indica resultado potencialmente incerto após uma interrupção. */
  publication?: "draft" | "sending" | "sent";
  /** Lembrete em revisão: rascunho aguardando aprovação, em envio (incerto se interrompido) ou enviado. */
  reminder?: "draft" | "sending" | "sent";
  /** A reserva antecede o envio; resultado incerto nunca é reenviado automaticamente. */
  teamsNotice?: { userId: string; link: string; status: "pending" | "attempted" | "sent" | "uncertain" };
};

/** Etapa em que a Tarefa está (ou a última em que esteve), para as interfaces de gestão. */
export type TaskStage = "triagem" | "assumir" | "veto" | "spec" | "implementacao" | "review" | "entrega";

/** De que a retrô trata: uma etapa de modelo, ou a Tarefa inteira (a consolidada). */
export type RetroStage = "triagem" | "spec" | "implementacao" | "review" | "mr" | "tarefa";

/** Os três tipos de proposta de retrô (SPEC, "Retrô"). */
export type RetroKind = "fabrica" | "conhecimento" | "repo-time";

/** Situação de uma proposta de retrô. */
export type RetroProposalStatus =
  /** Ainda não publicada (a retrô foi interrompida antes). */
  | "a-publicar"
  /** fábrica: abriu uma issue `retro`. */
  | "issue-criada"
  /** fábrica: comentou "+1" numa issue parecida já aberta. */
  | "mais-um"
  /** fábrica: uma issue parecida já citava esta Tarefa; nada a escrever. */
  | "ja-registrada"
  /** fábrica: no dry-run, a escrita só ficou registrada. */
  | "dry-run"
  /** fábrica: sem repositório da fábrica configurado (`FACTORY_RETRO_REPO`); só registrada. */
  | "sem-repo"
  /** fábrica: o escritor de efeitos barrou a escrita (ver `reason`). */
  | "bloqueada"
  /** conhecimento do projeto: aguarda aprovação do usuário. */
  | "pendente"
  /** repo do time: virou aviso ao usuário. */
  | "avisada";

export type RetroProposal = {
  n: number;
  kind: RetroKind;
  title: string;
  description: string;
  status: RetroProposalStatus;
  /** A issue aberta ou comentada (fábrica). */
  issue: { number: number; url: string } | null;
  reason: string | null;
};

/**
 * Uma retrô. A entrega do modelo é gravada antes de publicar: uma nova tentativa só publica o que falta, sem chamar o
 * modelo de novo.
 */
export type RetroRecord = {
  stage: RetroStage;
  status: "em-andamento" | "concluida" | "falhou";
  /** Tentativas que falharam; no limite, a retrô desiste (`falhou`) sem bloquear a Tarefa. */
  attempts: number;
  error: string | null;
  conversationId: ConversationId | null;
  /** Resumo do modelo; `null` até a entrega. */
  summary: string | null;
  /** Propostas classificadas; `null` até a entrega. */
  proposals: RetroProposal[] | null;
};

/** Triagem de uma issue de repositório monitorado (ADR-0014), gravada para uma nova tentativa não triar de novo. */
export type TriageRecord = {
  result: TriageResult;
  /** Decisão do usuário: rascunho aguardando, ou a decisão tomada na página. Sem revisão, `null`. */
  review: "draft" | "aceitar" | "recusar" | null;
};

/** Uma Tarefa da fábrica, na ordem da fila. */
export type QueuedTask = {
  /** `<projeto>/<card>`. */
  id: string;
  project: string;
  key: string;
  title: string;
  status: TaskStatus;
  /** Task durável que executa a Tarefa, depois de ativada pela primeira vez. */
  durableId: number | null;
  /** Task "portão" em que a Tarefa espera enquanto está pausada ou aguardando uma pessoa. */
  gateId: number | null;
  /** O usuário pediu pausa; a Tarefa ativa para no próximo passo. */
  pauseRequested: boolean;
  /** Depois de uma falha, a Tarefa só volta a ser ativada a partir deste instante (ms). */
  notBefore: number | null;
  attempts: number;
  reason: string | null;
  /** Estado do card quando a fábrica o enfileirou. Um card que já estava `in_progress` passa pelo prazo de veto. */
  startedIn?: CardState;
  /** Etapa atual; sem ela, a Tarefa ainda não começou. */
  stage?: TaskStage | null;
  /** Prazo de veto, aberto depois do comentário de assunção de um card que já estava em andamento. */
  veto?: VetoWindow | null;
  /**
   * Entrega do modelo na etapa SPEC, guardada antes de publicar. Uma nova tentativa da Tarefa (ex.: o Jira caiu entre
   * a SPEC e os Tickets) republica a mesma entrega, sem chamar o modelo de novo nem trocar uma SPEC válida.
   */
  delivery?: SpecDelivery | null;
  /**
   * Escopo do card como a Fonte o entregou por último (webhook do GitHub): descrição e checkboxes de aceite.
   * Ausente em Tarefas criadas pela busca.
   */
  scope?: { description: string; checkboxes: { done: number; total: number } } | null;
  /**
   * Issue do GitHub de onde a Tarefa veio, quando foi importada pelo repositório do App. Ausente em Tarefas criadas
   * pela configuração do YAML ou pela busca antiga: essas seguem pela chave do card.
   */
  origem?: OrigemGitHub;
  /**
   * O escopo mudou no GitHub depois de a Tarefa já estar em execução. A SPEC é refeita antes de qualquer código novo,
   * ou a Tarefa para se a implementação já começou (ver `scopeGate`).
   */
  specDirty?: boolean;
  /**
   * Quantas vezes a SPEC foi refeita por mudança de escopo. Entra no `requestId` da submissão à SPEC: o motor deduplica
   * submissões pelo `requestId`, então refazer com o mesmo identificador devolveria a SPEC antiga sem chamar o modelo.
   */
  specRevision?: number;
  /** Correções de review, dentro dos critérios já aprovados; cada uma ganha novo ciclo TDD. */
  correctionTickets?: SpecDelivery["tickets"];
  correctionRounds?: number;
  /** Resultado do review local, vinculado ao HEAD que foi realmente lido. */
  review?: {
    head: string;
    status: "em-andamento" | "aprovado" | "corrigir";
    summary: string;
    conversationId: ConversationId | null;
    feedbackRevision?: string;
  };
  /** Publicação remota. Ausente até o review; dry-run nunca se confunde com merge real. */
  publication?: {
    number: number | null;
    url: string | null;
    status: "dry-run" | "aguardando-ci" | "aguardando-review" | "aguardando-merge" | "merged";
    head: string;
    feedbackIds: string[];
    pendingFeedback?: { id: string; body: string; author: string }[];
  };
  /** Perguntas ao PO, na ordem; a última sem resposta é a que a Tarefa aguarda. */
  questions?: Question[];
  /** Revisão da SPEC/Tickets antes de publicar: rascunho aguardando aprovação, ou aprovada. */
  specReview?: "draft" | "approved";
  /** Modo autorizado na revisão da SPEC; ausente em aprovações antigas exige nova revisão. */
  specApprovedDryRun?: boolean;
  /** Etapas cuja retrô já segurou a Tarefa (`retroApproval`); retomada ou nova tentativa não seguram de novo. */
  retroHeld?: RetroStage[];
  /** Progresso da etapa de implementação, gravado a cada passo para a retomada não refazer nem duplicar nada. */
  implementation?: ImplementationProgress | null;
  /** Repositório escolhido explicitamente para esta Tarefa, ainda sujeito à configuração atual. */
  repositoryPath?: string;
  /**
   * Identificador opaco e estável da Tarefa, sem relação com o projeto nem com o card: é a única referência a ela que
   * sai para o repositório público da fábrica.
   */
  ref?: string;
  /** Retrôs das etapas e a consolidada, na ordem em que aconteceram. */
  retros?: RetroRecord[];
  /** Triagem da issue, nos projetos de repositório monitorado. */
  triage?: TriageRecord | null;
  /** Conversa da triagem com o modelo, criada antes do resultado; a SPEC nunca a reaproveita. */
  triageConversation?: ConversationId | null;
  /** Conversa da SPEC (grill), gravada quando a etapa cria ou retoma a conversa; base do trace da etapa. */
  specConversationId?: ConversationId | null;
  /** Conversas da SPEC esquecidas pelo usuário: ficam guardadas, mas não voltam ao contexto nem ao trace. */
  conversasEsquecidas?: ConversationId[];
};

/** Uma fase do ciclo TDD de um ticket: o teste que falha, depois o código que o faz passar. */
export type TddPhase = "teste" | "implementacao";

export type ImplementationProgress = {
  /** Cópia do usuário de onde o clone foi feito; a fábrica só lê dela. */
  repoPath: string;
  /** Clone próprio da fábrica, sob o diretório de estado. As ferramentas do modelo só enxergam este diretório. */
  worktree: string;
  /** A branch desta Tarefa. A fábrica só aceita force-push nela se a criou (`branchOrigin: "criada"`). */
  branch: string;
  /**
   * Se a fábrica criou a branch ou adotou uma que já existia no remoto com o nome da convenção (que pode ser de uma
   * pessoa). Sem o campo (progresso antigo), a branch não conta como da fábrica.
   */
  branchOrigin?: "criada" | "adotada";
  /** Padrão de commit resolvido no início da etapa (descoberto no histórico ou da config). */
  commitPattern: string;
  /** Comando de teste do repositório, fixado no início da etapa. */
  test: TestCommand;
  /** Formatador do repositório, fixado no início da etapa. Ausente: progresso antigo (vale o da config) ou nenhum. */
  format?: FormatCommand;
  /** Conversa do implementador; as ferramentas acham a Tarefa (e o clone) por ela. */
  conversationId: ConversationId;
  /** HEAD depois do último commit registrado. Um HEAD diferente na retomada é um commit que caiu antes do registro. */
  head: string;
  /** Base imutável do diff local e destino do PR/MR. Ausentes só em progresso legado. */
  baseHead?: string;
  defaultBranch?: string;
  /** Commits feitos, na ordem: um por fase de cada ticket. */
  commits: { ticket: number; phase: TddPhase; sha: string }[];
  /** Critérios de correção já atendidos: suíte no HEAD limpo e review independente, nunca fases RED/GREEN fictícias. */
  verifiedTickets?: { ticket: number; sha: string; diagnostic: string }[];
  /** Integração da base: recibo antes do merge, prova de suíte e novo HEAD; nunca altera fases TDD aceitas. */
  synchronization?: {
    base: string;
    previousHead: string;
    head?: string;
    status: "iniciada" | "concluida";
    attempts: number;
    paths: string[];
    diagnostic?: string;
  };
  /** Reparos humanos aprovados por revisão exata e suíte verde; distintos das fases executadas pelo modelo. */
  repairs?: { sha: string; ticket: number; revision: string }[];
  /** Pedidos feitos ao modelo; numera o próximo para que uma nova tentativa não reaproveite um pedido recusado. */
  requests: number;
  /**
   * Resultado da linha de base: a suíte rodada uma vez, antes do primeiro teste novo. Registrado para a retomada não
   * rodá-la de novo (com o teste novo já no clone, ela falharia). `null`: ainda não rodou.
   */
  baseline?: "verde" | "vermelha" | null;
  /** Diagnóstico limitado do baseline, sem segredos; falha de ambiente não prova o RED do TDD. */
  baselineDiagnostic?: string;
  /** Reserva durável antes de instalar: nunca repete indefinidamente após falhas ou reinícios. */
  environmentRecovery?: {
    attempts: number;
    status: "iniciada" | "recuperado" | "falhou";
    diagnostic: string;
  };
  /** Recusas seguidas da fábrica na fase atual (ex.: o teste novo não falhou). */
  rejections: number;
  /** Por que a fábrica recusou a última tentativa; vai junto do próximo pedido. */
  feedback: string | null;
  pushed: boolean;
};

export type FactoryState = {
  /** Escolha da interface web; prevalece sobre o valor inicial do ambiente. */
  retroRepo?: string;
  daemonPaused: boolean;
  tasks: QueuedTask[];
  /**
   * `X-GitHub-Delivery` das entregas do webhook já aplicadas, as mais recentes por último. O GitHub reenvia entregas
   * falhas com o mesmo identificador: reaplicar um fechamento antigo cancelaria uma Tarefa já reaberta.
   */
  deliveries?: string[];
  /**
   * Vínculo de cada projeto de repositório monitorado com o GitHub, por nome do projeto. Ausente = ativo (a config do
   * YAML manda). Só guarda o que mudou em runtime: desativação e a instalação de origem.
   */
  repos?: Record<string, RepoBinding>;
  /** Projetos pausados pelo usuário (ticket 09): nada novo começa neles e as Tarefas param no próximo passo. */
  projetosPausados?: string[];
  /** Projetos que trocaram a Fonte ou o repositório e aguardam a confirmação da configuração nova (ticket 10). */
  projetosAguardandoConfirmacao?: string[];
  /**
   * Projetos removidos pelo usuário (ticket 11), por nome. O nome fica reservado para sempre (o YAML não o semeia de novo
   * e as chaves das Tarefas não se misturam); o prefixo fica reservado enquanto houver Tarefas do projeto no histórico.
   */
  projetosRemovidos?: Record<string, { prefixo: string; quando: string }>;
  /** Última sincronização com o GitHub por projeto (ISO 8601): a próxima consulta de alterações parte daqui. */
  sincronizadoEm?: Record<string, string>;
  /** Quando a fábrica recebeu a última entrega do webhook (ISO 8601). Ausente = nenhuma ainda. Só para o painel do App. */
  ultimoWebhookEm?: string;
  /**
   * Importação de issues por repositório, indexada pelo id numérico do GitHub (ver `ImportacaoRepo`). Ausente em estados
   * antigos: nenhum repositório importado ainda.
   */
  importacoes?: Record<string, ImportacaoRepo>;
  /**
   * Projetos de repositório GitHub criados pela página Repositórios (ADR-0016), por nome. Entram na fábrica junto com os
   * do YAML no startup; um nome igual ao de um YAML é recusado na criação, então o YAML nunca é sobrescrito.
   * Guardado como JSON (o estado precisa ser compatível com JSON); no startup cada um passa de novo pelo schema.
   */
  projetosGitHub?: Record<string, string>;
  /**
   * Configuração de cada projeto, por nome (ADR-0017). Semeada do YAML na primeira execução; depois disso, o estado
   * manda. Guardado como JSON, validado de novo a cada leitura.
   */
  projetos?: Record<string, string>;
  /** Telegram do usuário, global aos projetos (fatia 09): chat e nome da credencial do bot no cofre, nunca o token. */
  telegramConfig?: { chat: string; usuario: string; credential?: string };
  /** Histórico de alterações de configuração por projeto, sem valores (fatia 12). */
  historicoConfig?: Record<string, { quando: string; autor: string; campos: string[] }[]>;
};

/**
 * Origem GitHub de uma Tarefa importada de issue. Os identificadores numéricos do GitHub são estáveis: renomear o
 * repositório ou o dono não muda `repoId` nem `issueId`, por isso a unicidade da importação usa só eles (`repo` é só
 * para exibição).
 */
export type OrigemGitHub = {
  /** Id numérico do repositório no GitHub. */
  repoId: number;
  /** `dono/nome` no momento da importação, para exibição. */
  repo: string;
  /** Id numérico da issue no GitHub. */
  issueId: number;
  /** Número da issue no repositório (o que aparece na URL). */
  issueNumber: number;
  /** Instalação do GitHub App que deu acesso ao repositório, quando conhecida. */
  installationId?: number;
};

/** Estado da importação de issues de um repositório do GitHub App. */
export type ImportacaoRepo = {
  repoId: number;
  repo: string;
  status: "nunca" | "importando" | "ok" | "erro";
  /** Última importação ou sincronização concluída (ISO 8601). */
  ultimaImportacaoEm?: string;
  /** Mensagem do último erro, sem token nem chave. Limpa quando a próxima importação dá certo. */
  ultimoErro?: string;
  installationId?: number;
  /** O que a última importação concluída fez com as issues abertas. */
  ultimoResultado?: { criadas: number; vinculadas: number; atualizadas: number; ignoradas: number };
};

/** Estado do repositório de um projeto monitorado, mudado por desplugue ou por eventos da instalação do App. */
export type RepoBinding = {
  repo: string;
  status: "ativo" | "desativado";
  /** Id numérico do repositório no GitHub, gravado na primeira entrega ou importação (Fase 4): sobrevive a renomeação. */
  repoId?: number;
  /** Instalação do GitHub App que trouxe o repositório, quando conhecida. */
  installationId?: number;
  /** Por que está desativado (exibido na página e nos avisos). */
  motivo?: string;
};

/** Estado da fila e do daemon, durável na sessão. */
export const StateDoc = defineDoc<FactoryState>({
  kind: "fabrica.estado",
  version: 1,
  scope: "session",
  initial: () => ({ daemonPaused: false, tasks: [] }),
  checkpointWhen: () => true,
});

/** Progresso de uma interface de gestão: o que já foi publicado e o que já foi recebido. */
export type ManagementProgress = {
  /** Próximo evento do log a publicar (índice). `null`: interface nova, começa pelos eventos que vierem. */
  eventCursor: number | null;
  /** Avisos aguardando o expediente do respectivo projeto; sobrevivem ao reinício. */
  deferred?: {
    project: string;
    /** Envelope já renderizado; filas legadas podem ter conteúdo full sem `source`. */
    message: { text: string; buttons?: { label: string; command: string }[] };
    /** Evento de origem: na entrega a política de conteúdo atual é reaplicada. */
    source?: FactoryEvent;
  }[];
  /** Próximo update a receber (no Telegram, o `offset` do `getUpdates`). */
  updateOffset: number;
  /** Diálogo de resposta por conversa/usuário autorizado, incluindo confirmação pendente. */
  answering?: Record<string, { id: string; n: number; draft?: string }>;
  /** Instante do último comando ou reinício preventivo da sequência. */
  lastUpdateAt?: number;
};

/** Progresso de cada interface de gestão, pelo nome dela: um reinício não republica nem reprocessa nada. */
export const ManagementDoc = defineDoc<Record<string, ManagementProgress>>({
  kind: "fabrica.gestao",
  version: 1,
  scope: "session",
  initial: () => ({}),
  checkpointWhen: () => true,
});

/** Um evento da fábrica, gravado no transcript da conversa raiz. */
export const EventEntry = defineEntry<JsonObject>("fabrica.evento");

/**
 * Cópia solta de um valor do estado durável. O rascunho que `tx.doc` devolve num commit não pode ser usado depois
 * dele: o que sai do commit (ou volta para outro lugar do documento) é sempre esta cópia, nunca o próprio rascunho.
 */
export const copyOutOfCommit = <T>(draft: T): T => JSON.parse(JSON.stringify(draft)) as T;

/** Converte um evento para o JSON gravado no transcript (sem campos `undefined`). */
export const eventToJson = (event: FactoryEvent): JsonObject => JSON.parse(JSON.stringify(event)) as JsonObject;

/** A Tarefa de `id` no estado, ou `undefined` se ela não existe. */
export const tarefaDoEstado = (estado: FactoryState, id: string): QueuedTask | undefined =>
  estado.tasks.find((t) => t.id === id);

/**
 * Tarefa que nasce na fila: enfileirada, sem execução durável, sem tentativas e sem entrega. É a única forma de criar um
 * registro novo: a busca, o webhook e a importação passam por aqui, para o formato inicial não divergir.
 */
export function novaTarefa(campos: {
  id: string;
  project: string;
  key: string;
  title: string;
  ref: string;
  startedIn: CardState;
  scope?: QueuedTask["scope"];
  origem?: OrigemGitHub;
}): QueuedTask {
  return {
    id: campos.id,
    project: campos.project,
    key: campos.key,
    title: campos.title,
    ref: campos.ref,
    status: "enfileirada",
    durableId: null,
    gateId: null,
    pauseRequested: false,
    notBefore: null,
    attempts: 0,
    reason: null,
    startedIn: campos.startedIn,
    veto: null,
    delivery: null,
    implementation: null,
    ...(campos.scope !== undefined ? { scope: campos.scope } : {}),
    ...(campos.origem ? { origem: campos.origem } : {}),
  };
}
