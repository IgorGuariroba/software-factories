import type { EscolhasPessoas } from "../../../pessoas-fonte.js";
import type { FactoryCommands } from "./comandos.js";
import type { Pedido, Resposta, RespostaApi, Rota } from "./despacho.js";
import { ehJson } from "./guardas.js";

type Manipulador = (pedido: Pedido, capturas: string[]) => Promise<RespostaApi>;

interface Definicao {
  metodo: Rota["metodo"];
  caminho: string | RegExp;
  documentada: string;
  criar(comandos: FactoryCommands): Manipulador;
}

const SEM_JSON: Resposta = { status: 415, body: { error: "envie Content-Type: application/json" } };
const naoEhObjeto = (valor: unknown): boolean => typeof valor !== "object" || valor === null || Array.isArray(valor);
const decodificar = (captura: string | undefined): string => decodeURIComponent(captura ?? "");
/** Id da Tarefa a partir do projeto e da chave do card, como aparecem no caminho. */
const idDe = (projeto: string | undefined, chave: string | undefined): string =>
  `${decodificar(projeto)}/${decodificar(chave)}`;

/** Escolhas de PO e tech lead do corpo da criação: texto vazio ou ausente vira "não escolhida". */
export function lerEscolhasPessoas(bruto: unknown): EscolhasPessoas | undefined {
  if (naoEhObjeto(bruto)) return undefined;
  const { po, techLead } = bruto as { po?: unknown; techLead?: unknown };
  const texto = (valor: unknown) => (typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined);
  return { po: texto(po), techLead: texto(techLead) };
}

/** Comando de teste em argv: cada item precisa ter texto, e a lista vazia é válida (o projeto nasce incompleto). */
function lerComando(bruto: unknown): string[] | undefined {
  const comando = Array.isArray(bruto) ? bruto.map((item) => (typeof item === "string" ? item.trim() : "")) : [];
  return comando.some((item) => item === "") ? undefined : comando;
}

const HORARIO_INVALIDO = "horario: use business-hours (horário comercial) ou always (sempre ativo)";
const COMANDO_INVALIDO = "comando de teste: cada argumento precisa ter texto";
const REGEX_SEGREDO = /^[a-z0-9][a-z0-9-]{1,63}$/;
const REGEX_REPO = /^[\w.-]+\/[\w.-]+$/;
const ETAPAS_RETRO = "(triagem|spec|implementacao|review|mr|tarefa)";

/** Ação simples sobre a Tarefa (pausar, retomar, cancelar): 404 se a Tarefa não existe. */
const acaoTarefa = (acao: "pause" | "resume" | "cancel"): Definicao => ({
  metodo: "POST",
  caminho: new RegExp(`^\\/tasks\\/([^/]+)\\/([^/]+)\\/${acao}$`),
  documentada: `/tasks/{project}/{key}/${acao}`,
  criar: (c) => async (_pedido, cap) => {
    const id = idDe(cap[0], cap[1]);
    return (await c[acao](id))
      ? { status: 200, body: { ok: true } }
      : { status: 404, body: { error: `Tarefa ${id} não existe` } };
  },
});

/**
 * Rotas do adaptador. Cada uma traduz o pedido em uma chamada a `FactoryCommands`; regra de estado fica no comando.
 */
const DEFINICOES: Definicao[] = [
  {
    metodo: "GET",
    caminho: "/daemon",
    documentada: "/daemon",
    criar: (c) => async () => ({ status: 200, body: { paused: await c.daemonPausado() } }),
  },
  {
    metodo: "POST",
    caminho: "/daemon/pause",
    documentada: "/daemon/pause",
    criar: (c) => async () => {
      await c.setDaemonPaused(true);
      return { status: 200, body: { ok: true } };
    },
  },
  {
    metodo: "POST",
    caminho: "/daemon/resume",
    documentada: "/daemon/resume",
    criar: (c) => async () => {
      await c.setDaemonPaused(false);
      return { status: 200, body: { ok: true } };
    },
  },
  {
    metodo: "GET",
    caminho: "/queue",
    documentada: "/queue",
    criar: (c) => async () => ({ status: 200, body: await c.fila() }),
  },
  {
    metodo: "GET",
    caminho: "/tasks",
    documentada: "/tasks",
    criar: (c) => async () => ({ status: 200, body: await c.tarefas() }),
  },
  {
    metodo: "GET",
    caminho: "/events",
    documentada: "/events",
    criar: (c) => async () => ({ status: 200, body: c.eventos() }),
  },
  {
    metodo: "GET",
    caminho: "/events/stream",
    documentada: "/events/stream",
    criar: (c) => async () => c.eventosFluxo(),
  },
  {
    metodo: "GET",
    caminho: "/ferramentas",
    documentada: "/ferramentas",
    criar: (c) => async () => ({ status: 200, body: c.ferramentas() }),
  },
  {
    metodo: "GET",
    caminho: "/openapi.json",
    documentada: "/openapi.json",
    criar: (c) => async () => ({ status: 200, body: c.esquema() }),
  },
  {
    metodo: "GET",
    caminho: "/projetos",
    documentada: "/projetos",
    criar: (c) => async () => ({ status: 200, body: c.projetosCarregados() }),
  },
  {
    metodo: "GET",
    caminho: "/integracoes/canais",
    documentada: "/integracoes/canais",
    criar: (c) => async () => ({ status: 200, body: c.canais() }),
  },
  {
    metodo: "GET",
    caminho: "/integracoes/fontes",
    documentada: "/integracoes/fontes",
    criar: (c) => async () => ({ status: 200, body: c.integracoesFontes() }),
  },
  {
    metodo: "GET",
    caminho: "/perfis/modelos",
    documentada: "/perfis/modelos",
    criar: (c) => async () => ({ status: 200, body: c.perfisProntos() }),
  },
  {
    metodo: "GET",
    caminho: "/repos",
    documentada: "/repos",
    criar: (c) => async () => ({ status: 200, body: await c.repos() }),
  },
  {
    metodo: "GET",
    caminho: "/github-app",
    documentada: "/github-app",
    criar: (c) => async () => ({ status: 200, body: await c.githubApp() }),
  },
  {
    metodo: "GET",
    caminho: "/github/repos",
    documentada: "/github/repos",
    criar: (c) => async () => ({ status: 200, body: await c.githubRepos() }),
  },

  {
    metodo: "POST",
    caminho: "/projetos/github",
    documentada: "/projetos/github",
    criar: (c) => async (pedido) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      const body = (await pedido.corpo()) as
        | {
            repoId?: unknown;
            nome?: unknown;
            fonte?: unknown;
            horario?: unknown;
            ensaio?: unknown;
            comandoTeste?: unknown;
            pessoas?: unknown;
          }
        | undefined;
      if (!Number.isInteger(body?.repoId) || typeof body?.nome !== "string" || naoEhObjeto(body.fonte))
        return { status: 400, body: { error: "informe repoId, nome e a fonte (objeto com type e os campos dela)" } };
      if (body.horario !== undefined && body.horario !== "business-hours" && body.horario !== "always")
        return { status: 400, body: { error: HORARIO_INVALIDO } };
      // Sem comando nenhum o projeto nasce incompleto (ticket 08); um item vazio no meio do argv é erro de digitação.
      const comando = lerComando(body.comandoTeste);
      if (!comando) return { status: 400, body: { error: COMANDO_INVALIDO } };
      return c.projetos.criarGithub({
        repoId: body.repoId as number,
        nome: body.nome.trim(),
        fonte: body.fonte as Record<string, unknown>,
        horario: body.horario === "always" ? "always" : "business-hours",
        ensaio: body.ensaio !== false,
        comandoTeste: comando,
        pessoas: lerEscolhasPessoas(body.pessoas),
      });
    },
  },
  {
    metodo: "POST",
    caminho: "/projetos/gitlab",
    documentada: "/projetos/gitlab",
    criar: (c) => async (pedido) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      const body = (await pedido.corpo()) as
        | {
            nome?: unknown;
            caminho?: unknown;
            servidor?: unknown;
            fonte?: unknown;
            horario?: unknown;
            ensaio?: unknown;
            comandoTeste?: unknown;
            pessoas?: unknown;
          }
        | undefined;
      if (typeof body?.nome !== "string" || typeof body?.caminho !== "string" || naoEhObjeto(body.fonte))
        return { status: 400, body: { error: "informe nome, caminho (grupo/projeto), servidor e a fonte (objeto)" } };
      if (body.servidor !== undefined && typeof body.servidor !== "string")
        return { status: 400, body: { error: "servidor: informe a URL do GitLab como texto" } };
      if (body.horario !== undefined && body.horario !== "business-hours" && body.horario !== "always")
        return { status: 400, body: { error: HORARIO_INVALIDO } };
      const comando = lerComando(body.comandoTeste);
      if (!comando) return { status: 400, body: { error: COMANDO_INVALIDO } };
      return c.projetos.criarGitlab({
        nome: body.nome.trim(),
        caminho: body.caminho,
        servidor: body.servidor ?? "",
        fonte: body.fonte as Record<string, unknown>,
        horario: body.horario === "always" ? "always" : "business-hours",
        ensaio: body.ensaio !== false,
        comandoTeste: comando,
        pessoas: lerEscolhasPessoas(body.pessoas),
      });
    },
  },
  {
    metodo: "POST",
    caminho: "/projetos/pessoas-da-fonte",
    documentada: "/projetos/pessoas-da-fonte",
    criar: (c) => async (pedido) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      return c.projetos.pessoasParaCriacao(await pedido.corpo());
    },
  },
  {
    metodo: "POST",
    caminho: "/github/importar",
    documentada: "/github/importar",
    criar: (c) => async (pedido) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      const body = (await pedido.corpo()) as { repoId?: unknown } | undefined;
      if (!Number.isInteger(body?.repoId) || (body?.repoId as number) <= 0)
        return { status: 400, body: { error: "informe repoId, o id numérico do repositório no GitHub" } };
      return c.projetos.importarRepo(body?.repoId as number);
    },
  },
  {
    metodo: "POST",
    caminho: "/repos/plugar",
    documentada: "/repos/plugar",
    criar: (c) => async (pedido) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      const body = (await pedido.corpo()) as { repo?: unknown } | undefined;
      if (typeof body?.repo !== "string" || !REGEX_REPO.test(body.repo.trim()))
        return { status: 400, body: { error: "informe o repositório no formato dono/nome" } };
      return c.projetos.plugarRepo(body.repo.trim());
    },
  },
  {
    metodo: "POST",
    caminho: "/repos/desplugar",
    documentada: "/repos/desplugar",
    criar: (c) => async (pedido) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      const body = (await pedido.corpo()) as { repo?: unknown; force?: unknown } | undefined;
      if (typeof body?.repo !== "string" || !REGEX_REPO.test(body.repo.trim()))
        return { status: 400, body: { error: "informe o repositório no formato dono/nome" } };
      return c.projetos.desplugarRepo(body.repo.trim(), body.force === true);
    },
  },
  {
    metodo: "POST",
    caminho: /^\/projetos\/([^/]+)\/(pausa|retomada)$/,
    documentada: "/projetos/{nome}/pausa",
    criar: (c) => async (_pedido, cap) => {
      const nome = decodificar(cap[0]);
      return cap[1] === "pausa" ? c.projetos.pausar(nome) : c.projetos.retomar(nome);
    },
  },
  {
    metodo: "POST",
    caminho: /^\/projetos\/([^/]+)\/remocao$/,
    documentada: "/projetos/{nome}/remocao",
    criar: (c) => async (pedido, cap) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      const corpo = (await pedido.corpo()) as { confirmar?: unknown } | undefined;
      return c.projetos.remover(decodificar(cap[0]), corpo?.confirmar);
    },
  },

  // --- Tarefas ---
  {
    metodo: "GET",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)$/,
    documentada: "/tasks/{project}/{key}",
    criar: (c) => async (_pedido, cap) => c.tarefa(idDe(cap[0], cap[1])),
  },
  acaoTarefa("pause"),
  acaoTarefa("resume"),
  acaoTarefa("cancel"),
  {
    metodo: "POST",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/veto$/,
    documentada: "/tasks/{project}/{key}/veto",
    criar: (c) => async (_pedido, cap) => {
      const id = idDe(cap[0], cap[1]);
      const resultado = await c.veto(id);
      if (resultado === "inexistente") return { status: 404, body: { error: `Tarefa ${id} não existe` } };
      if (resultado === "fora-do-prazo")
        return {
          status: 409,
          body: { error: `Tarefa ${id} não está aguardando veto (o prazo já passou ou não houve)` },
        };
      return { status: 200, body: { ok: true, status: "vetada" } };
    },
  },
  {
    metodo: "GET",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/trace$/,
    documentada: "/tasks/{project}/{key}/trace",
    criar: (c) => async (_pedido, cap) => c.trace(idDe(cap[0], cap[1])),
  },
  {
    metodo: "POST",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/etapas\/([^/]+)\/memoria\/esquecer$/,
    documentada: "/tasks/{project}/{key}/etapas/{etapa}/memoria/esquecer",
    criar: (c) => async (_pedido, cap) => c.esquecerMemoria(idDe(cap[0], cap[1]), decodificar(cap[2])),
  },
  {
    metodo: "POST",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/etapas\/([^/]+)\/mensagem$/,
    documentada: "/tasks/{project}/{key}/etapas/{etapa}/mensagem",
    criar: (c) => async (pedido, cap) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      const corpo = (await pedido.corpo()) as { texto?: unknown } | undefined;
      if (typeof corpo?.texto !== "string" || corpo.texto.trim() === "")
        return { status: 400, body: { error: "informe texto, a mensagem para o agente" } };
      return c.mensagemEtapa(idDe(cap[0], cap[1]), decodificar(cap[2]), corpo.texto.trim());
    },
  },
  {
    metodo: "GET",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/repair$/,
    documentada: "/tasks/{project}/{key}/repair",
    criar: (c) => async (_pedido, cap) => c.previaReparo(idDe(cap[0], cap[1])),
  },
  {
    metodo: "POST",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/repair$/,
    documentada: "/tasks/{project}/{key}/repair",
    criar: (c) => async (pedido, cap) => {
      if (!ehJson(pedido.contentType)) return { status: 400, body: { error: "envie JSON" } };
      return c.aplicarReparo(idDe(cap[0], cap[1]), await pedido.corpo());
    },
  },
  {
    metodo: "GET",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/triage$/,
    documentada: "/tasks/{project}/{key}/triage",
    criar: (c) => async (_pedido, cap) => c.previaTriagem(idDe(cap[0], cap[1])),
  },
  {
    metodo: "POST",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/triage\/decide$/,
    documentada: "/tasks/{project}/{key}/triage/decide",
    criar: (c) => async (pedido, cap) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      return c.decidirTriagem(idDe(cap[0], cap[1]), await pedido.corpo());
    },
  },
  {
    metodo: "GET",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/spec$/,
    documentada: "/tasks/{project}/{key}/spec",
    criar: (c) => async (_pedido, cap) => c.previaSpec(idDe(cap[0], cap[1])),
  },
  {
    metodo: "POST",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/spec\/approve$/,
    documentada: "/tasks/{project}/{key}/spec/approve",
    criar: (c) => async (pedido, cap) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      return c.aprovarSpec(idDe(cap[0], cap[1]), await pedido.corpo());
    },
  },
  {
    metodo: "GET",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/questions\/(\d+)\/reminder$/,
    documentada: "/tasks/{project}/{key}/questions/{n}/reminder",
    criar: (c) => async (_pedido, cap) => c.previaLembrete(idDe(cap[0], cap[1]), Number(cap[2])),
  },
  {
    metodo: "POST",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/questions\/(\d+)\/reminder\/approve$/,
    documentada: "/tasks/{project}/{key}/questions/{n}/reminder/approve",
    criar: (c) => async (pedido, cap) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      return c.aprovarLembrete(idDe(cap[0], cap[1]), Number(cap[2]), await pedido.corpo());
    },
  },
  {
    metodo: "POST",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/questions\/(\d+)\/answer$/,
    documentada: "/tasks/{project}/{key}/questions/{n}/answer",
    criar: (c) => async (pedido, cap) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      const corpo = (await pedido.corpo()) as { answer?: unknown } | undefined;
      if (typeof corpo?.answer !== "string" || !corpo.answer.trim() || corpo.answer.length > 20_000)
        return { status: 400, body: { error: "resposta deve ter entre 1 e 20000 caracteres" } };
      return c.responderPergunta(idDe(cap[0], cap[1]), Number(cap[2]), corpo.answer.trim());
    },
  },
  {
    metodo: "GET",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/questions\/(\d+)$/,
    documentada: "/tasks/{project}/{key}/questions/{n}",
    criar: (c) => async (_pedido, cap) => c.previaPergunta(idDe(cap[0], cap[1]), Number(cap[2])),
  },
  {
    metodo: "POST",
    caminho: /^\/tasks\/([^/]+)\/([^/]+)\/questions\/(\d+)\/approve$/,
    documentada: "/tasks/{project}/{key}/questions/{n}/approve",
    criar: (c) => async (pedido, cap) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      return c.aprovarPergunta(idDe(cap[0], cap[1]), Number(cap[2]), await pedido.corpo());
    },
  },
  {
    metodo: "GET",
    caminho: new RegExp(`^\\/tasks\\/([^/]+)\\/([^/]+)\\/retros\\/${ETAPAS_RETRO}\\/(\\d+)$`),
    documentada: "/tasks/{project}/{key}/retros/{stage}/{n}",
    criar: (c) => async (_pedido, cap) => c.previaRetro(idDe(cap[0], cap[1]), decodificar(cap[2]), Number(cap[3])),
  },
  {
    metodo: "POST",
    caminho: new RegExp(`^\\/tasks\\/([^/]+)\\/([^/]+)\\/retros\\/${ETAPAS_RETRO}\\/(\\d+)\\/approve$`),
    documentada: "/tasks/{project}/{key}/retros/{stage}/{n}/approve",
    criar: (c) => async (pedido, cap) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      return c.aprovarRetro(idDe(cap[0], cap[1]), decodificar(cap[2]), Number(cap[3]), await pedido.corpo());
    },
  },
  {
    metodo: "POST",
    caminho: "/tasks/order",
    documentada: "/tasks/order",
    criar: (c) => async (pedido) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      const body = (await pedido.corpo()) as { ids?: unknown } | undefined;
      if (!Array.isArray(body?.ids)) return { status: 400, body: { error: "envie { ids: string[] }" } };
      await c.reorder(body.ids.map(String));
      return { status: 200, body: { ok: true } };
    },
  },
  // --- Projetos (leitura, confirmação, configuração) e segredos ---
  {
    metodo: "GET",
    caminho: /^\/projetos\/([^/]+)\/pendencias$/,
    documentada: "/projetos/{nome}/pendencias",
    criar: (c) => async (_pedido, cap) => c.pendenciasProjeto(decodificar(cap[0])),
  },
  {
    metodo: "GET",
    caminho: /^\/projetos\/([^/]+)\/estado$/,
    documentada: "/projetos/{nome}/estado",
    criar: (c) => async (_pedido, cap) => c.estadoProjeto(decodificar(cap[0])),
  },
  {
    metodo: "POST",
    caminho: /^\/projetos\/([^/]+)\/confirmacao$/,
    documentada: "/projetos/{nome}/confirmacao",
    criar: (c) => async (_pedido, cap) => c.confirmarFonteProjeto(decodificar(cap[0])),
  },
  {
    metodo: "GET",
    caminho: /^\/projetos\/([^/]+)\/historico$/,
    documentada: "/projetos/{nome}/historico",
    criar: (c) => async (_pedido, cap) => c.historicoProjeto(decodificar(cap[0])),
  },
  {
    metodo: "GET",
    caminho: /^\/projetos\/([^/]+)\/configuracao$/,
    documentada: "/projetos/{nome}/configuracao",
    criar: (c) => async (_pedido, cap) => c.configuracaoProjeto(decodificar(cap[0])),
  },
  {
    metodo: "PUT",
    caminho: /^\/projetos\/([^/]+)\/configuracao$/,
    documentada: "/projetos/{nome}/configuracao",
    criar: (c) => async (pedido, cap) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      return c.salvarConfiguracaoProjeto(decodificar(cap[0]), await pedido.corpo());
    },
  },
  {
    metodo: "GET",
    caminho: "/settings/retro",
    documentada: "/settings/retro",
    criar: (c) => async () => c.retroConfiguracao(),
  },
  {
    metodo: "POST",
    caminho: "/settings/retro",
    documentada: "/settings/retro",
    criar: (c) => async (pedido) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      return c.salvarRetroConfiguracao(await pedido.corpo());
    },
  },
  {
    metodo: "GET",
    caminho: "/telegram/configuracao",
    documentada: "/telegram/configuracao",
    criar: (c) => async () => c.telegramConfiguracao(),
  },
  {
    metodo: "PUT",
    caminho: "/telegram/configuracao",
    documentada: "/telegram/configuracao",
    criar: (c) => async (pedido) => {
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      return c.salvarTelegramConfiguracao(await pedido.corpo());
    },
  },
  {
    metodo: "GET",
    caminho: "/segredos",
    documentada: "/segredos",
    criar: (c) => async () => ({ status: 200, body: await c.listarSegredos() }),
  },
  {
    metodo: "PUT",
    caminho: /^\/segredos\/([^/]+)$/,
    documentada: "/segredos/{nome}",
    criar: (c) => async (pedido, cap) => {
      const nome = decodificar(cap[0]);
      if (!REGEX_SEGREDO.test(nome))
        return { status: 400, body: { error: "nome: use minúsculas, números e hífen (2 a 64 caracteres)" } };
      if (!ehJson(pedido.contentType)) return SEM_JSON;
      return c.gravarSegredo(nome, await pedido.corpo());
    },
  },
  {
    metodo: "POST",
    caminho: "/poll",
    documentada: "/poll",
    criar: (c) => async () => c.poll(),
  },
];

/** As rotas do adaptador, ligadas aos comandos da fábrica. */
export function criarRotasApi(comandos: FactoryCommands): Rota[] {
  return DEFINICOES.map((d) => ({
    metodo: d.metodo,
    caminho: d.caminho,
    documentada: d.documentada,
    manipular: (pedido, capturas) => d.criar(comandos)(pedido, capturas),
  }));
}

/** Método e caminho documentado de cada rota do adaptador, sem ligar manipuladores. */
export function rotasDocumentadas(): { metodo: Rota["metodo"]; documentada: string }[] {
  return DEFINICOES.map(({ metodo, documentada }) => ({ metodo, documentada }));
}
