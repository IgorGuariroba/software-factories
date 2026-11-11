import type { ProjectConfig } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import type { Escrita } from "./escrita-efeitos.js";
import { withAutomationMark } from "./marca-automacao.js";
import { privateTerms, sanitizePublicText } from "./public-text.js";
import type { RetroSink } from "./retro-sink.js";
import { redactSecrets } from "./secrets.js";

// Efeitos da retrô da fábrica no repositório público da fábrica: o texto revisado e a escrita (issue nova ou comentário).
// Passam pelo mesmo motor de escrita (guardrails e dry-run) que os demais efeitos do projeto.

/** O motor de escrita: aplica os guardrails, registra e executa (ou só registra, no dry-run). */
export type MotorDeEscrita = <T>(
  w: Escrita,
  check: () => Promise<string | undefined>,
  run: () => Promise<T>,
  dry: () => T,
  once?: boolean,
) => Promise<T>;

/** O que os efeitos de retrô precisam: o projeto, a Fonte, a configuração de retrô e o motor de escrita. */
export interface DepsEfeitosRetro {
  config: ProjectConfig;
  source: DemandSource;
  retro?: { sink?: RetroSink; repo?: string };
  write: MotorDeEscrita;
}

/** Os efeitos de retrô, com as mesmas assinaturas que o escritor de efeitos publica. */
export interface EfeitosDeRetro {
  openRetroIssue(
    cardKey: string,
    repo: string,
    issue: { title: string; body: string },
  ): Promise<{ number: number; url: string } | undefined>;
  publicRetroText(cardKey: string, text: string): Promise<string>;
  publicRetroPreview(cardKey: string, text: string): Promise<{ text: string; leftovers: string[] }>;
  commentRetroIssue(cardKey: string, repo: string, issue: number, body: string): Promise<void>;
}

export function criarEfeitosDeRetro(deps: DepsEfeitosRetro): EfeitosDeRetro {
  const { config, source, retro, write } = deps;
  /** Texto que vai ao repositório público: sem segredos e saneado dos valores do projeto e do card. */
  async function publicText(cardKey: string, raw: string) {
    const card = await source.getCard(cardKey);
    return sanitizePublicText(redactSecrets(raw), {
      terms: privateTerms(config, [cardKey, card?.title ?? ""]),
      cardPrefix: config.source.project,
    });
  }
  const retroSink = (): RetroSink => {
    const sink = retro?.sink;
    if (!sink) throw new Error("RetroSink não configurado");
    return sink;
  };
  function retroRefused(repo: string, leftovers: string[]): string | undefined {
    const target = retro?.repo;
    if (!retro?.sink || !target) return "nenhum repositório da fábrica configurado (FACTORY_RETRO_REPO)";
    if (repo !== target) return `o RetroSink só escreve no repositório da fábrica (${target}), não em ${repo}`;
    if (leftovers.length > 0) return `o texto público ainda cita valores do projeto: ${leftovers.join(", ")}`;
    return undefined;
  }

  return {
    async publicRetroText(cardKey: string, text: string) {
      return (await publicText(cardKey, text)).text;
    },
    publicRetroPreview: publicText,
    async openRetroIssue(cardKey, repo, issue) {
      const title = await publicText(cardKey, issue.title);
      const body = await publicText(cardKey, issue.body);
      const content = withAutomationMark(body.text);
      return write<{ number: number; url: string } | undefined>(
        { target: `${cardKey}#retro`, action: "retro-issue", content: `${repo}: ${title.text}\n\n${content}` },
        async () => retroRefused(repo, [...title.leftovers, ...body.leftovers]),
        () => retroSink().create(repo, { title: title.text, body: content }),
        () => undefined,
      );
    },

    async commentRetroIssue(cardKey, repo, issue, raw) {
      const body = await publicText(cardKey, raw);
      const content = withAutomationMark(body.text);
      return write(
        { target: `${cardKey}#retro`, action: "retro-comment", content: `${repo}#${issue}: ${content}` },
        async () => retroRefused(repo, body.leftovers),
        () => retroSink().comment(repo, issue, content),
        () => undefined,
      );
    },
  };
}
