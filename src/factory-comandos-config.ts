import type { Context } from "@earendil-works/chord/context";
import type { Harness } from "@earendil-works/pi-durable";
import { StateDoc } from "./durable.js";
import type { FactoryCommands } from "./packages/api-local/index.js";
import type { ConfiguracaoProjetos } from "./packages/configuracao-projeto/index.js";
import type { Credenciais } from "./packages/credenciais/index.js";
import type { Decisoes } from "./packages/decisoes/index.js";
import type { SecretStore } from "./packages/secret-store/index.js";
import type { ConfiguracaoTelegramModulo } from "./packages/telegram-config/index.js";
import { isRetroRepository } from "./retro-settings.js";

// Comandos de configuração da fábrica (projetos, segredos, repositório das retrôs e Telegram): as regras estão nos
// pacotes; aqui só se junta o grupo ao objeto de comandos da API.

/** Peças da fábrica que os comandos de configuração usam. */
export interface DepsComandosConfiguracao {
  configProjetos: ConfiguracaoProjetos;
  segredos: SecretStore;
  credenciais: Credenciais;
  telegramConfig: ConfiguracaoTelegramModulo;
  decisoes: Decisoes;
  harness: Harness;
  context: Context;
  /** Repositório das retrôs: o valor atual, e o sink que publica (ausente, a publicação está indisponível). */
  retroSettings: { repo?: string; sink?: unknown };
}

type ComandosDeConfiguracao = Pick<
  FactoryCommands,
  | "pendenciasProjeto"
  | "estadoProjeto"
  | "confirmarFonteProjeto"
  | "historicoProjeto"
  | "configuracaoProjeto"
  | "salvarConfiguracaoProjeto"
  | "listarSegredos"
  | "gravarSegredo"
  | "retroConfiguracao"
  | "salvarRetroConfiguracao"
  | "telegramConfiguracao"
  | "salvarTelegramConfiguracao"
>;

/** Comandos de configuração, prontos para entrar no objeto de comandos da API. */
export function comandosDeConfiguracao(deps: DepsComandosConfiguracao): ComandosDeConfiguracao {
  const { configProjetos, segredos, credenciais, telegramConfig, decisoes, harness, context, retroSettings } = deps;
  return {
    // Projetos: leitura, confirmação e configuração, no pacote configuracao-projeto.
    pendenciasProjeto: (nome) => configProjetos.pendencias(nome),
    estadoProjeto: (nome) => configProjetos.estado(nome),
    confirmarFonteProjeto: (nome) => configProjetos.confirmarFonte(nome),
    historicoProjeto: (nome) => configProjetos.historico(nome),
    configuracaoProjeto: (nome) => configProjetos.configuracao(nome),
    salvarConfiguracaoProjeto: (nome, corpo) => configProjetos.salvar(nome, corpo),
    // Segredos do cofre.
    listarSegredos: () => segredos.list(),
    gravarSegredo: (nome, corpo) => credenciais.gravar(nome, corpo),
    // Publicações (repositório das retrôs da fábrica).
    retroConfiguracao: async () => ({
      status: 200,
      body: { repo: retroSettings.repo ?? null, available: Boolean(retroSettings.sink) },
    }),
    salvarRetroConfiguracao: async (corpo) => {
      const body = corpo as { repo?: unknown } | undefined;
      if (typeof body?.repo !== "string" || !isRetroRepository(body.repo.trim()))
        return { status: 400, body: { error: "Informe o repositório no formato dono/nome, sem URL." } };
      if (!retroSettings.sink)
        return { status: 409, body: { error: "Adaptador de publicação indisponível neste daemon." } };
      const repo = body.repo.trim();
      return decisoes.configurarRepositorioRetro(async () => {
        await harness.commit(async (tx) => {
          (await tx.doc(StateDoc)).retroRepo = repo;
        }, context);
        retroSettings.repo = repo;
        return { status: 200, body: { repo, available: true } };
      });
    },
    // Telegram: a interface de gestão do celular, configuração no pacote telegram-config.
    telegramConfiguracao: () => telegramConfig.obter(),
    salvarTelegramConfiguracao: (corpo) => telegramConfig.salvar(corpo),
  };
}
