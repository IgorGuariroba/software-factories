import { ehJson } from "./guardas.js";
import type { Definicao } from "./rotas-comum.js";
import {
  COMANDO_INVALIDO,
  comJson,
  decodificar,
  HORARIO_INVALIDO,
  lerComando,
  lerEscolhasPessoas,
  naoEhObjeto,
  REGEX_REPO,
  SEM_JSON,
} from "./rotas-comum.js";

export const DEFINICOES_PROJETOS: Definicao[] = [
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
    criar: (c) => comJson((corpo, cap) => c.salvarConfiguracaoProjeto(decodificar(cap[0]), corpo)),
  },
];
