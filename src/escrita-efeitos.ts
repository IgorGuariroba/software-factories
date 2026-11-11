import type { ProjectConfig } from "./config.js";
import type { EventRecorder } from "./events.js";
import { GuardrailViolation } from "./marca-automacao.js";

// Motor de escrita da fábrica: todo efeito externo passa por `write` (guardrails, registro no log e execução, ou só o
// registro no dry-run). A regra de cada projeto (o que pode ser escrito) fica com quem chama, em `check`.

/** Escrita de um efeito: destino, ação e conteúdo (o que a identifica para a deduplicação). */
export type Escrita = { target: string; action: string; content: string };

/**
 * Cria o motor de escrita de um projeto. O dry-run não chega ao sistema; as escritas idempotentes (todas menos
 * `comment`) são registradas uma vez só por destino, ação e conteúdo, inclusive depois de um reinício.
 */
export function criarMotorDeEscrita(opts: { config: ProjectConfig; events: EventRecorder }) {
  const { config, events } = opts;
  const dryRunIds = new Set<string>();

  /**
   * Se o dry-run já registrou esta escrita (mesmo destino, ação e conteúdo). O log de eventos é durável, então a
   * lembrança sobrevive a um reinício: no dry-run nada chega ao sistema, e é só por ela que uma escrita idempotente
   * repetida (ex.: um passo refeito depois de um reinício) não aparece de novo.
   */
  const dryRunRegistered = (w: { target: string; action: string; content: string }) =>
    events
      .list()
      .some(
        (e) =>
          e.type === "write" &&
          e.dryRun &&
          e.project === config.name &&
          e.target === w.target &&
          e.action === w.action &&
          e.content === w.content,
      );

  /** Autoriza inclusive operações idempotentes antes de procurar uma escrita anterior. */
  async function authorize(
    w: { target: string; action: string; content: string },
    check: () => Promise<string | undefined>,
  ): Promise<void> {
    const reason = await check();
    if (reason) {
      await events.append({ type: "blocked", project: config.name, ...w, reason });
      throw new GuardrailViolation(`Guardrail: ${w.action} em ${w.target} bloqueado: ${reason}`);
    }
  }

  /**
   * Aplica os guardrails, registra e executa (ou só registra, no dry-run). Com `once` (escritas idempotentes: todas
   * menos `comment`), o dry-run não registra de novo uma escrita que já registrou.
   */
  async function write<T>(
    w: { target: string; action: string; content: string },
    check: () => Promise<string | undefined>,
    run: () => Promise<T>,
    dry: () => T,
    once = true,
  ): Promise<T> {
    await authorize(w, check);
    if (config.dryRun && once && dryRunRegistered(w)) return dry();
    await events.append({ type: "write", project: config.name, ...w, dryRun: config.dryRun });
    return config.dryRun ? dry() : run();
  }

  /** Id fictício de um comentário do dry-run, que `editComment` aceita sem procurar na Fonte. */
  const dryRunComment = () => {
    const id = `dry-run-${dryRunIds.size + 1}`;
    dryRunIds.add(id);
    return { id };
  };
  return { authorize, write, dryRunComment, dryRunIds };
}
