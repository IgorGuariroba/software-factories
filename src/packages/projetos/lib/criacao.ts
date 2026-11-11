import { rm } from "node:fs/promises";
import { ProjectConfig } from "../../../config.js";
import {
  clonarRepositorioGitlab,
  hostDoServidor,
  SERVIDOR_PADRAO,
  verificarRepositorioGitlab,
} from "../../../gitlab-repositorio.js";
import {
  conferirEscolhasPessoas,
  type EscolhasPessoas,
  type PessoaDaFonte,
  pessoasDeAssignees,
} from "../../../pessoas-fonte.js";
import { conflitoProjeto, montarProjetoGithub, padroesDe, pessoasDoProjeto } from "../../../projetos-github.js";
import { redactSecrets } from "../../../secrets.js";
import { estadoDoProjeto, pendenciasDeConfiguracao } from "../../config-store/index.js";
import { testarConexaoJira } from "../../integracoes/index.js";
import { repoDoCatalogo } from "./catalogo.js";
import { listarPessoasGitlabDoModulo, listarPessoasJiraDoModulo } from "./pessoas.js";
import type { EstadoProjetos, PortasProjetos, Resposta } from "./portas.js";

/** Corpo da criação de um projeto a partir de um repositório do catálogo do GitHub App. */
export interface CorpoCriacaoGithub {
  repoId: number;
  nome: string;
  fonte: Record<string, unknown>;
  horario: "always" | "business-hours";
  ensaio: boolean;
  comandoTeste: string[];
  pessoas?: EscolhasPessoas;
}

/** Projetos salvos pela interface, incluindo os ainda não carregados no processo. Registro inválido é ignorado. */
export function salvosDe(state: EstadoProjetos): ProjectConfig[] {
  return Object.values(state.projetosGitHub ?? {}).flatMap((texto) => {
    const lido = ProjectConfig.safeParse(JSON.parse(texto));
    return lido.success ? [lido.data] : [];
  });
}

/** Conflito de nome, prefixo ou Fonte com o que já existe. Conferido antes de qualquer chamada ao provedor. */
async function conflitoAgora(portas: PortasProjetos, config: ProjectConfig): Promise<string | undefined> {
  const state = await portas.estado.ler();
  return conflitoProjeto(
    {
      nome: config.name,
      prefixo: config.source.project,
      fonteTipo: config.source.type,
      fonteRepo: "repo" in config.source ? config.source.repo : undefined,
    },
    [...portas.projetosAtivos(), ...salvosDe(state)],
    portas.regras.projetosReservados(state),
  );
}

/** Erro de credencial ou de conexão da Fonte. Só a Fonte Jira é consultada; nada é gravado aqui. */
export async function erroDaFonte(portas: PortasProjetos, fonte: ProjectConfig["source"]): Promise<string | undefined> {
  if (fonte.type === "jira") {
    if (!fonte.credential) return undefined;
    if (!(await portas.segredos.has(fonte.credential))) return `credencial ${fonte.credential} não cadastrada`;
    if (!fonte.baseUrl || !fonte.email) return "a Fonte Jira com credencial precisa de baseUrl e email";
    const conexao = await testarConexaoJira({
      baseUrl: fonte.baseUrl,
      email: fonte.email,
      token: (await portas.segredos.get(fonte.credential)) ?? "",
      fetch: portas.fetchFonte ?? fetch,
    });
    return conexao.ok ? undefined : `conexão com o Jira falhou (${conexao.motivo})`;
  }
  if (fonte.credential && !(await portas.segredos.has(fonte.credential)))
    return `credencial ${fonte.credential} não cadastrada`;
  return undefined;
}

/**
 * Conferência das escolhas de PO e tech lead na Fonte antes de gravar. Sem escolha, não há consulta: o projeto nasce
 * incompleto. Fonte fora do ar responde 502; pessoa desconhecida, 400. Nos dois casos nada é gravado.
 */
export async function conferirEscolhas(
  portas: PortasProjetos,
  fonte: ProjectConfig["source"],
  escolhas: EscolhasPessoas | undefined,
  instalacaoId?: number,
): Promise<{ erro?: Resposta; lista: PessoaDaFonte[] }> {
  if (escolhas?.po === undefined && escolhas?.techLead === undefined) return { lista: [] };
  if (fonte.type === "jira" && (!fonte.credential || !fonte.baseUrl || !fonte.email))
    return {
      erro: {
        status: 400,
        body: { error: "para escolher PO e tech lead, a Fonte Jira precisa de credencial, baseUrl e email" },
      },
      lista: [],
    };
  let lista: PessoaDaFonte[];
  try {
    if (fonte.type === "gitlab")
      lista = await listarPessoasGitlabDoModulo(
        portas,
        fonte.hostname ?? SERVIDOR_PADRAO,
        fonte.repo,
        fonte.credential ?? "",
      );
    else if (fonte.type === "jira")
      lista = await listarPessoasJiraDoModulo(
        portas,
        fonte.baseUrl ?? "",
        fonte.email ?? "",
        fonte.credential ?? "",
        fonte.project,
      );
    else if (instalacaoId === undefined) throw new Error("repositório sem instalação do GitHub App");
    else lista = pessoasDeAssignees(await portas.github.responsaveisPossiveis(fonte.repo, instalacaoId));
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "falha ao consultar a Fonte";
    return { erro: { status: 502, body: { error: `${motivo}; o projeto não foi salvo` } }, lista: [] };
  }
  const erro = conferirEscolhasPessoas(escolhas, lista, fonte.type);
  return erro ? { erro: { status: 400, body: { error: erro } }, lista } : { lista };
}

/**
 * Grava um projeto novo cujo repositório é clonado antes. Nome, prefixo e Fonte não podem repetir o que existe, nas duas
 * pontas (antes e depois do clone). O clone sai antes da gravação: se falhar, nada fica salvo pela metade.
 */
export async function criarClonado(
  portas: PortasProjetos,
  projeto: {
    config: ProjectConfig;
    destino: string;
    clonar: () => Promise<void>;
    /** Dados extras do estado que só um tipo de repositório precisa (ex.: o plugue do catálogo do GitHub App). */
    ajustarEstado?: (state: EstadoProjetos) => void;
  },
): Promise<Resposta> {
  const { config, destino } = projeto;
  try {
    await projeto.clonar();
  } catch (err) {
    return { status: 502, body: { error: redactSecrets(err instanceof Error ? err.message : "falha ao clonar") } };
  }

  let resposta: Resposta = { status: 500, body: { error: "projeto não registrado" } };
  let registrar = false;
  await portas.estado.alterar((state) => {
    const conflito = conflitoProjeto(
      {
        nome: config.name,
        prefixo: config.source.project,
        fonteTipo: config.source.type,
        fonteRepo: "repo" in config.source ? config.source.repo : undefined,
      },
      [...portas.projetosAtivos(), ...salvosDe(state)],
      portas.regras.projetosReservados(state),
    );
    if (conflito) {
      resposta = { status: 409, body: { error: conflito } };
      return;
    }
    state.projetosGitHub = { ...state.projetosGitHub, [config.name]: JSON.stringify(config) };
    state.projetos = { ...state.projetos, [config.name]: JSON.stringify(config) };
    state.historicoConfig = {
      ...state.historicoConfig,
      [config.name]: [{ quando: new Date(portas.agora()).toISOString(), autor: "usuario", campos: ["projeto criado"] }],
    };
    projeto.ajustarEstado?.(state);
    registrar = true;
    const pendencias = pendenciasDeConfiguracao(config);
    resposta = {
      status: 201,
      body: {
        projeto: config.name,
        repo: "repo" in config.source ? config.source.repo : undefined,
        prefixo: config.source.project,
        fonte: config.source.type,
        horario: config.activity,
        ensaio: config.dryRun,
        estado: estadoDoProjeto(pendencias),
        pendencias,
      },
    };
  });
  if (registrar) portas.registrar(config);
  else await rm(destino, { recursive: true, force: true });
  return resposta;
}

/** Recusas que valem para qualquer criação pela interface: daemon sem criação ou YAML sem projeto padrão. */
function prontoParaCriar(
  portas: PortasProjetos,
): { erro: Resposta } | { padrao: NonNullable<PortasProjetos["padrao"]> } {
  if (!portas.criacaoHabilitada)
    return { erro: { status: 409, body: { error: "este daemon não cria projetos pela interface" } } };
  if (!portas.padrao) return { erro: { status: 409, body: { error: "nenhum projeto no YAML para servir de padrão" } } };
  return { padrao: portas.padrao };
}

/** Monta o projeto a partir do padrão; um erro de montagem vira resposta 400 (nada é consultado nem gravado). */
function montarOuRecusar(montar: () => ProjectConfig): { config: ProjectConfig } | { erro: Resposta } {
  try {
    return { config: montar() };
  } catch (err) {
    return { erro: { status: 400, body: { error: err instanceof Error ? err.message : "projeto inválido" } } };
  }
}

/** Fonte com credencial e conexão válidas, e sem conflito de nome, prefixo ou Fonte com o que já existe. */
async function conferirFonteEConflito(portas: PortasProjetos, config: ProjectConfig): Promise<Resposta | undefined> {
  const erroFonte = await erroDaFonte(portas, config.source);
  if (erroFonte) return { status: 400, body: { error: erroFonte } };
  const conflito = await conflitoAgora(portas, config);
  if (conflito) return { status: 409, body: { error: conflito } };
  return undefined;
}

/**
 * Último passo comum das duas criações: confere as pessoas escolhidas na Fonte, põe PO e tech lead no projeto e grava
 * o clone. `instalacaoId` só existe no GitHub (a consulta de responsáveis passa pelo App).
 */
async function criarComPessoas(
  portas: PortasProjetos,
  config: ProjectConfig,
  escolhas: EscolhasPessoas | undefined,
  instalacaoId: number | undefined,
  opcoes: {
    clonar(config: ProjectConfig, destino: string): Promise<void>;
    ajustarEstado?(state: EstadoProjetos, config: ProjectConfig): void;
  },
): Promise<Resposta> {
  const pessoas = await conferirEscolhas(portas, config.source, escolhas, instalacaoId);
  if (pessoas.erro) return pessoas.erro;
  const completo = { ...config, ...pessoasDoProjeto(escolhas, config.source.type, pessoas.lista) };
  const destino = completo.repositories?.[0]?.path ?? portas.caminhoDoClone(completo.name);
  return criarClonado(portas, {
    config: completo,
    destino,
    clonar: () => opcoes.clonar(completo, destino),
    ...(opcoes.ajustarEstado
      ? { ajustarEstado: (state: EstadoProjetos) => opcoes.ajustarEstado?.(state, completo) }
      : {}),
  });
}

/**
 * Cria um projeto a partir de um repositório do catálogo do App (ADR-0016, ADR-0022). A Fonte e o horário vêm do
 * formulário; o repositório é clonado em diretório gerenciado antes de gravar.
 */
export async function criarGithub(portas: PortasProjetos, corpo: CorpoCriacaoGithub): Promise<Resposta> {
  const pronto = prontoParaCriar(portas);
  if ("erro" in pronto) return pronto.erro;
  if (corpo.fonte.type === "gitlab")
    return { status: 400, body: { error: "a Fonte GitLab Issues é criada por caminho: use POST /projetos/gitlab" } };
  const encontrado = await repoDoCatalogo(portas, corpo.repoId);
  if ("erro" in encontrado) return encontrado.erro;
  const { repo } = encontrado;

  const montado = montarOuRecusar(() =>
    montarProjetoGithub({
      padroes: padroesDe(pronto.padrao),
      repo: repo.nome,
      caminho: portas.caminhoDoClone(corpo.nome),
      nome: corpo.nome,
      fonte: corpo.fonte,
      horario: corpo.horario,
      ensaio: corpo.ensaio,
      comandoTeste: corpo.comandoTeste,
    }),
  );
  if ("erro" in montado) return montado.erro;
  const recusaDeFonte = await conferirFonteEConflito(portas, montado.config);
  if (recusaDeFonte) return recusaDeFonte;
  return criarComPessoas(portas, montado.config, corpo.pessoas, repo.instalacaoId, {
    clonar: (_config, destino) =>
      (portas.clonarGithub ?? ((c) => portas.github.clonar(c.repo, c.instalacaoId, c.destino)))({
        repo: repo.nome,
        instalacaoId: repo.instalacaoId,
        destino,
      }),
    ajustarEstado: (state, config) => {
      state.repos = {
        ...state.repos,
        [config.name]: { repo: repo.nome, status: "ativo", repoId: repo.id, installationId: repo.instalacaoId },
      };
    },
  });
}

/** Corpo da criação de um projeto a partir de um repositório GitLab informado por caminho (`grupo/projeto`). */
export interface CorpoCriacaoGitlab {
  nome: string;
  caminho: string;
  servidor: string;
  fonte: Record<string, unknown>;
  horario: "always" | "business-hours";
  ensaio: boolean;
  comandoTeste: string[];
  pessoas?: EscolhasPessoas;
}

/**
 * Cria um projeto a partir de um repositório GitLab (gitlab.com ou self-hosted). O token vem do cofre pelo nome da
 * credencial, e o caminho é conferido com ele antes de qualquer gravação: repositório inexistente ou token sem acesso
 * são recusados com a causa.
 */
export async function criarGitlab(portas: PortasProjetos, corpo: CorpoCriacaoGitlab): Promise<Resposta> {
  const pronto = prontoParaCriar(portas);
  if ("erro" in pronto) return pronto.erro;
  const credencial = corpo.fonte.credential;
  if (typeof credencial !== "string" || credencial === "")
    return { status: 400, body: { error: "informe a credencial do token do GitLab (cadastrada no cofre)" } };

  let host: string;
  try {
    host = hostDoServidor(corpo.servidor);
  } catch (err) {
    return { status: 400, body: { error: err instanceof Error ? err.message : "servidor inválido" } };
  }
  const caminho = corpo.caminho.trim();
  const montado = montarOuRecusar(() =>
    montarProjetoGithub({
      padroes: padroesDe(pronto.padrao),
      repo: caminho,
      caminho: portas.caminhoDoClone(corpo.nome),
      nome: corpo.nome,
      fonte: {
        ...corpo.fonte,
        type: "gitlab",
        repo: caminho,
        ...(host === SERVIDOR_PADRAO ? {} : { hostname: host }),
      },
      horario: corpo.horario,
      ensaio: corpo.ensaio,
      comandoTeste: corpo.comandoTeste,
    }),
  );
  if ("erro" in montado) return montado.erro;
  const recusaDeFonte = await conferirFonteEConflito(portas, montado.config);
  if (recusaDeFonte) return recusaDeFonte;

  // O caminho é conferido com o token antes de gravar: repositório inexistente ou sem acesso são recusados com a causa.
  const token = (await portas.segredos.get(credencial)) ?? "";
  const erroRepo = await verificarRepositorioGitlab({
    host,
    caminho,
    token,
    fetch: portas.fetchGitlab ?? fetch,
  });
  if (erroRepo) return { status: 400, body: { error: erroRepo } };
  return criarComPessoas(portas, montado.config, corpo.pessoas, undefined, {
    clonar: (_config, destino) => (portas.clonarGitlab ?? clonarRepositorioGitlab)({ host, caminho, token, destino }),
  });
}
