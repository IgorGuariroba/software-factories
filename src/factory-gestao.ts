import type { Context } from "@earendil-works/chord/context";
import type { Harness } from "@earendil-works/pi-durable";
import { nextProjectActivity } from "./business-hours.js";
import type { ProjectConfig } from "./config.js";
import type { FactoryState, ManagementProgress } from "./durable.js";
import { ManagementDoc } from "./estado-fabrica.js";
import type { FactoryClock } from "./factory.js";
import { type ManagementBridgeDeps, type ManagementInterface, startManagementBridge } from "./management.js";
import type { FactoryCommands } from "./packages/api-local/index.js";
import type { SecretStore } from "./packages/secret-store/index.js";
import { interfaceSalvaVigente, reiniciaAposSalvar } from "./packages/telegram-config/index.js";

// Interface de gestão da fábrica (Telegram): a ligação com a configuração das variáveis de ambiente ou a salva pela API,
// e o reinício quando a configuração muda. A regra de quando reiniciar e de qual configuração vale está nos pacotes.

/** Peças da fábrica que a interface de gestão usa. */
export interface DepsGestao {
  /** Interface definida pelas variáveis de ambiente: tem prioridade sobre a salva. */
  management: { port: ManagementInterface; chat: string; user?: string } | undefined;
  criarInterfaceTelegram?: (token: string, chat: string) => ManagementInterface;
  segredos: SecretStore;
  readState(): Promise<FactoryState>;
  harness: Harness;
  context: Context;
  events: ManagementBridgeDeps["events"];
  initialEventCount: number;
  projects: ReadonlyMap<string, { config: ProjectConfig }>;
  clock: FactoryClock;
  armTimer: ManagementBridgeDeps["armTimer"];
  commands: FactoryCommands;
}

/** A interface de gestão em uso e as operações sobre ela. */
export interface Gestao {
  /** Reinicia a interface depois de uma configuração salva pela API (só se ela não vem do ambiente). */
  reiniciar(): Promise<void>;
  /** Para a interface, na parada da fábrica. */
  parar(): Promise<void>;
}

/** Liga a interface de gestão: a do ambiente, ou a salva pela API (o token sai do cofre). */
export async function iniciarGestao(deps: DepsGestao): Promise<Gestao> {
  // A regra (credencial, criação possível, token no cofre) está no pacote telegram-config.
  async function interfaceDeGestaoSalva(): Promise<
    { port: ManagementInterface; chat: string; user: string } | undefined
  > {
    const salva = await interfaceSalvaVigente({
      guardada: async () => (await deps.readState()).telegramConfig,
      podeCriarInterface: Boolean(deps.criarInterfaceTelegram),
      tokenDe: (credencial) => deps.segredos.get(credencial),
    });
    if (!salva || !deps.criarInterfaceTelegram) return undefined;
    return { port: deps.criarInterfaceTelegram(salva.token, salva.chat), chat: salva.chat, user: salva.usuario };
  }

  async function montarBridge(management: { port: ManagementInterface; chat: string; user?: string } | undefined) {
    return (
      management &&
      (await startManagementBridge({
        ...management,
        events: deps.events,
        initialEventCount: deps.initialEventCount,
        progress: {
          load: async () => {
            const stored = (await deps.harness.snapshot(ManagementDoc, deps.context))?.[management.port.name];
            return stored && { ...stored };
          },
          save: (progress: ManagementProgress) =>
            deps.harness.commit(async (tx) => {
              (await tx.doc(ManagementDoc))[management.port.name] = progress;
            }, deps.context),
        },
        tasks: async () => (await deps.readState()).tasks,
        commands: deps.commands,
        content: (project) => deps.projects.get(project)?.config.telegram?.content ?? "full",
        contextLabel: (name) => (deps.projects.get(name)?.config.activity === "business-hours" ? "Empresa" : "Pessoal"),
        availableAt: (name) => {
          const config = deps.projects.get(name)?.config;
          return config ? nextProjectActivity(config, deps.clock.now()) : deps.clock.now();
        },
        now: deps.clock.now,
        armTimer: deps.armTimer,
      }))
    );
  }

  // Variáveis de ambiente, quando definidas, têm prioridade sobre a configuração salva.
  let bridge = await montarBridge(deps.management ?? (await interfaceDeGestaoSalva()));
  return {
    /** Telegram salvo pela API vale sem reiniciar; a variável de ambiente continua prioritária. */
    async reiniciar() {
      if (!reiniciaAposSalvar(Boolean(deps.management))) return;
      const anterior = bridge;
      bridge = undefined;
      await anterior?.stop();
      bridge = await montarBridge(await interfaceDeGestaoSalva());
    },
    async parar() {
      await bridge?.stop();
    },
  };
}
