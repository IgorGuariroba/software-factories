import { ehJson } from "./guardas.js";
import type { Definicao } from "./rotas-comum.js";
import { acaoTarefa, comJson, decodificar, ETAPAS_RETRO, idDe, SEM_JSON } from "./rotas-comum.js";

export const DEFINICOES_TAREFAS: Definicao[] = [
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
    criar: (c) => comJson((corpo, cap) => c.decidirTriagem(idDe(cap[0], cap[1]), corpo)),
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
    criar: (c) => comJson((corpo, cap) => c.aprovarSpec(idDe(cap[0], cap[1]), corpo)),
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
    criar: (c) => comJson((corpo, cap) => c.aprovarLembrete(idDe(cap[0], cap[1]), Number(cap[2]), corpo)),
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
    criar: (c) => comJson((corpo, cap) => c.aprovarPergunta(idDe(cap[0], cap[1]), Number(cap[2]), corpo)),
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
    criar: (c) =>
      comJson((corpo, cap) => c.aprovarRetro(idDe(cap[0], cap[1]), decodificar(cap[2]), Number(cap[3]), corpo)),
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
];
