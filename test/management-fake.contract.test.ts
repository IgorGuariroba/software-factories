import { createTelegramBot } from "../src/telegram.js";
import { FakeBotApi } from "./fakes/fake-bot-api.js";
import { FakeTelegram } from "./fakes/fake-telegram.js";
import { describeManagementContract } from "./management.contract.js";

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
