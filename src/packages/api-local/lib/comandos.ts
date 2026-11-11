import type { ProjetosModulo } from "../../projetos/index.js";
import type { Resposta, RespostaFluxo } from "./despacho.js";

/** Resultado de veto: a Tarefa ficou vetada, não existe, ou o prazo já passou. */
export type VetoResult = "vetada" | "inexistente" | "fora-do-prazo";

/**
 * Contrato entre a API local e a fábrica. O adaptador HTTP só traduz pedidos e respostas; cada operação aqui tem a regra
 * de estado na fábrica. As que a API já usava (pausar, veto, reordenar…) ficam com a assinatura que o Telegram e a
 * interface de gestão também usam. As demais devolvem `Resposta` (código e corpo) pronta para o cliente.
 */
export interface FactoryCommands {
  // Comandos compartilhados com o Telegram e a interface de gestão.
  pause(id: string): Promise<boolean>;
  resume(id: string): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
  /** Veta, dentro do prazo, a Tarefa de um card que já estava em andamento. */
  veto(id: string): Promise<VetoResult>;
  setDaemonPaused(paused: boolean): Promise<void>;
  pausarProjeto(nome: string): Promise<void>;
  retomarProjeto(nome: string): Promise<void>;
  reorder(ids: string[]): Promise<void>;
  /** Responde localmente sem publicar na Fonte; false se a pergunta não está disponível. */
  answerQuestion(id: string, n: number, answer: string): Promise<boolean>;

  // Consultas.
  /** Stream dos eventos da fábrica, ao vivo, para a interface de gestão. */
  eventosFluxo(): RespostaFluxo;
  daemonPausado(): Promise<boolean>;
  fila(): Promise<unknown>;
  tarefas(): Promise<unknown>;
  eventos(): unknown;
  ferramentas(): unknown;
  esquema(): unknown;
  projetosCarregados(): unknown;
  canais(): unknown;
  integracoesFontes(): unknown;
  perfisProntos(): unknown;
  repos(): Promise<unknown>;
  githubApp(): Promise<unknown>;
  githubRepos(): Promise<unknown>;
  /** Ciclo de vida de projetos (criar, plugar, importar, pausar, remover). */
  projetos: ProjetosModulo;

  // Tarefas: leitura, etapas e aprovações de publicação. Cada uma valida o estado e responde com o código HTTP.
  tarefa(id: string): Promise<Resposta>;
  trace(id: string): Promise<Resposta>;
  esquecerMemoria(id: string, etapa: string): Promise<Resposta>;
  mensagemEtapa(id: string, etapa: string, texto: string): Promise<Resposta>;
  previaReparo(id: string): Promise<Resposta>;
  aplicarReparo(id: string, corpo: unknown): Promise<Resposta>;
  previaTriagem(id: string): Promise<Resposta>;
  decidirTriagem(id: string, corpo: unknown): Promise<Resposta>;
  previaSpec(id: string): Promise<Resposta>;
  aprovarSpec(id: string, corpo: unknown): Promise<Resposta>;
  previaLembrete(id: string, n: number): Promise<Resposta>;
  aprovarLembrete(id: string, n: number, corpo: unknown): Promise<Resposta>;
  responderPergunta(id: string, n: number, texto: string): Promise<Resposta>;
  previaPergunta(id: string, n: number): Promise<Resposta>;
  aprovarPergunta(id: string, n: number, corpo: unknown): Promise<Resposta>;
  previaRetro(id: string, etapa: string, n: number): Promise<Resposta>;
  aprovarRetro(id: string, etapa: string, n: number, corpo: unknown): Promise<Resposta>;
  /** Busca agora na Fonte, uma por vez. */
  poll(): Promise<Resposta>;

  // Projetos: leitura, confirmação e configuração. Cada uma responde com o código HTTP e o corpo.
  pendenciasProjeto(nome: string): Promise<Resposta>;
  estadoProjeto(nome: string): Promise<Resposta>;
  confirmarFonteProjeto(nome: string): Promise<Resposta>;
  historicoProjeto(nome: string): Promise<Resposta>;
  configuracaoProjeto(nome: string): Promise<Resposta>;
  salvarConfiguracaoProjeto(nome: string, corpo: unknown): Promise<Resposta>;

  // Publicações das retrôs e Telegram: leitura e gravação da configuração.
  retroConfiguracao(): Promise<Resposta>;
  salvarRetroConfiguracao(corpo: unknown): Promise<Resposta>;
  telegramConfiguracao(): Promise<Resposta>;
  salvarTelegramConfiguracao(corpo: unknown): Promise<Resposta>;

  // Segredos do cofre. Gravar valida o que a credencial usa antes de trocá-la.
  listarSegredos(): Promise<unknown>;
  gravarSegredo(nome: string, corpo: unknown): Promise<Resposta>;
}
