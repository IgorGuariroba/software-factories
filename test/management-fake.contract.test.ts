import { expect, it } from "vitest";
import { createTelegramBot } from "../src/telegram.js";
import { FakeBotApi } from "./fakes/fake-bot-api.js";
import { FakeTelegram } from "./fakes/fake-telegram.js";
import { describeManagementContract } from "./management.contract.js";

it("aceita nova sequência menor após uma semana mesmo quando houve apenas updates sem comando", async () => {
  let now = 0;
  const api = new FakeBotApi("token", "1001");
  const port = createTelegramBot({
    token: "token",
    chat: "1001",
    fetch: api.fetch,
    apiBase: FakeBotApi.BASE,
    pollSeconds: 0,
    now: () => now,
  });
  api.otherUpdate();
  expect(await port.receive(0, new AbortController().signal)).toEqual([]);
  now += 7 * 24 * 60 * 60 * 1000 + 1;
  api.resetSequence(1);
  api.userSays("/pausar");
  expect(await port.receive(0, new AbortController().signal)).toMatchObject([{ id: 1, text: "/pausar" }]);
});

it("limita uma chamada de envio que não responde", async () => {
  const waiting: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("prazo excedido")), { once: true });
    });
  const port = createTelegramBot({ token: "token", chat: "1", fetch: waiting, requestTimeoutMs: 20 });
  await expect(port.send({ text: "mensagem" })).rejects.toThrow(/prazo excedido/);
});

it("limita a espera de getUpdates quando a rede não responde", async () => {
  const waiting: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("prazo excedido")), { once: true });
    });
  const port = createTelegramBot({ token: "token", chat: "1", fetch: waiting, pollSeconds: 0, requestTimeoutMs: 20 });
  await expect(port.receive(0, new AbortController().signal)).rejects.toThrow(/prazo excedido/);
});

it("limita também a leitura da resposta da Bot API", async () => {
  const waiting: typeof fetch = async (_url, init) =>
    ({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("prazo excedido")), { once: true });
        }),
    }) as Response;
  const port = createTelegramBot({ token: "token", chat: "1", fetch: waiting, requestTimeoutMs: 20 });
  await expect(port.answerButton("botao", "ok")).rejects.toThrow();
});

it("cancela o envio quando a ponte encerra", async () => {
  const controller = new AbortController();
  const waiting: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("cancelado")), { once: true });
    });
  const port = createTelegramBot({ token: "token", chat: "1", fetch: waiting });
  const sending = port.send({ text: "mensagem" }, controller.signal);
  controller.abort();
  await expect(sending).rejects.toThrow(/cancelado/);
});

describeManagementContract("FakeTelegram (fake em memória)", () => {
  const telegram = new FakeTelegram();
  return {
    port: telegram,
    unreachable: new FakeTelegram({ unreachable: true }),
    simulate: { say: (text) => telegram.say(text), tap: (command) => telegram.tap({ label: "b", command }) },
    delivered: () => telegram.texts(),
  };
});

describeManagementContract("Telegram (adaptador real contra uma Bot API falsa)", () => {
  const token = "token-de-teste-do-bot";
  const api = new FakeBotApi(token, "1001");
  // Falha de rede como a do undici: a causa traz a URL, com o token dentro.
  const offline: typeof fetch = async (input) => {
    throw new TypeError("fetch failed", { cause: new Error(`connect ECONNREFUSED ${String(input)}`) });
  };
  return {
    port: createTelegramBot({ token, chat: "1001", fetch: api.fetch, apiBase: FakeBotApi.BASE, pollSeconds: 1 }),
    unreachable: createTelegramBot({ token, chat: "1001", fetch: offline, apiBase: FakeBotApi.BASE }),
    secret: token,
    simulate: { say: (text) => api.userSays(text), tap: (data) => api.userTaps(data), other: () => api.otherUpdate() },
    delivered: () => api.messages.map((m) => m.text),
  };
});
