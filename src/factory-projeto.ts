import { realpath } from "node:fs/promises";
import { type Channel, createPersonChannel } from "./channel.js";
import type { CardState } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import type { FactoryState } from "./durable.js";
import { createEffectWriter, type EffectWriter } from "./effect-writer.js";
import type { EventRecorder } from "./events.js";
import type { FactoryProject } from "./factory.js";
import { defaultBranch, git } from "./git.js";
import { gitCodeHost } from "./git-code-host.js";
import { comCalendarioEfetivo } from "./packages/configuracao-projeto/index.js";
import type { Registro } from "./packages/integracoes/lib/registro.js";
import { canalDaPessoa, identidadeDoCanalTeams } from "./packages/profiles/index.js";
import { branchRevisada } from "./packages/tarefa/index.js";
import type { RetroSink } from "./retro-sink.js";
import type { TeamsConversation } from "./teams-conversa.js";

/** Peças da fábrica que a montagem de um projeto usa. */
export interface DepsMontagemProjeto {
  eventRecorder: EventRecorder;
  /** Limite de transição de cards neste marco (a fábrica não move um card além dele). */
  transitionLimit: CardState;
  readState(): Promise<FactoryState>;
  retroSettings: { repo?: string; sink?: RetroSink };
  canais: Pick<Registro<CanalConfigFabrica, Channel>, "create">;
  teamsConversation?: TeamsConversation;
}

/** O que um canal de conversa ou de aviso precisa para ser criado a partir de um projeto. */
export interface CanalConfigFabrica {
  source: DemandSource;
  writer: EffectWriter;
  conversation?: TeamsConversation;
  personMri?: string;
  dryRun?: boolean;
}

/**
 * Monta um projeto carregado: o escritor de efeitos (com os guardrails e a verificação de branch), o canal de cada
 * pessoa (comentário no card ou Teams) e o host de código. A regra de cada parte está nos pacotes e nos módulos próprios.
 */
export function montarProjetoDaFabrica(p0: FactoryProject, deps: DepsMontagemProjeto) {
  const { eventRecorder, transitionLimit, readState, retroSettings, canais, teamsConversation } = deps;
  let p = p0;
  // Execução e SLAs usam o mesmo calendário efetivo, inclusive feriados legais (regra no pacote configuracao-projeto).
  p = { ...p, config: comCalendarioEfetivo(p.config) };
  const codeHost = p.codeHost ?? gitCodeHost;
  const writer: EffectWriter = createEffectWriter({
    ...p,
    events: eventRecorder,
    transitionLimit,
    codeHost,
    // Branch da fábrica é a que ela criou, registrada no estado durável de uma Tarefa deste projeto; não um padrão
    // de nome, nem uma branch adotada do remoto (que pode ser de uma pessoa).
    isFactoryBranch: async (branch) =>
      (await readState()).tasks.some(
        (t) =>
          t.project === p.config.name &&
          t.implementation?.branch === branch &&
          t.implementation.branchOrigin === "criada",
      ),
    isReviewedBranch: async (cardKey, cwd, draft) => {
      const task = (await readState()).tasks.find((t) => t.project === p.config.name && t.key === cardKey);
      // A decisão (branch aprovada, SPEC aprovada no mesmo ensaio, HEAD e base) está no pacote tarefa.
      return branchRevisada({
        cwd,
        rascunho: draft,
        progresso: task?.implementation,
        revisao: task?.review,
        exigeAprovacaoSpec: p.config.specApproval,
        specRevisao: task?.specReview,
        specAprovadaEmEnsaio: task?.specApprovedDryRun,
        dryRun: p.config.dryRun,
        caminhoReal: (caminho) => realpath(caminho).catch(() => null),
        branchPadrao: (caminho) => defaultBranch(caminho),
        headDoCwd: async (caminho) => (await git(caminho, ["rev-parse", "HEAD"])).trim(),
      });
    },
    retro: retroSettings,
  });
  const pessoaDe = (personId: string) => p.config.people.find((x) => x.id === personId);
  const padrao = canais.create("card-comment", { source: p.source, writer });
  const channel: Channel = createPersonChannel({
    padrao,
    escolheTeams: (personId) => {
      const pessoa = pessoaDe(personId);
      return pessoa !== undefined && canalDaPessoa(pessoa) === "teams";
    },
    teamsDe: (personId) => {
      // Disponibilidade do canal Teams (pessoa, identidade e conversa configurada) é regra do pacote profiles.
      const conversa = teamsConversation;
      const personMri = identidadeDoCanalTeams(pessoaDe(personId), Boolean(conversa));
      if (!personMri || !conversa) return undefined;
      return canais.create("teams", {
        source: p.source,
        writer,
        conversation: conversa,
        personMri,
        dryRun: p.config.dryRun,
      });
    },
  });
  return { ...p, codeHost, writer, channel };
}
