import { ehJson } from "./guardas.js";
import type { Definicao } from "./rotas-comum.js";
import { decodificar, REGEX_SEGREDO, SEM_JSON } from "./rotas-comum.js";

export const DEFINICOES_SISTEMA: Definicao[] = [
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
