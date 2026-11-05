import { describe } from "vitest";
import { createTelegramBot } from "../src/telegram.js";
import { describeManagementContract } from "./management.contract.js";

const token = process.env.TEST_TELEGRAM_BOT_TOKEN;
const chat = process.env.TEST_TELEGRAM_CHAT_ID;

if (token && chat) {
  describeManagementContract("Telegram (Bot API real - opt-in)", () => ({
    port: createTelegramBot({ token, chat, pollSeconds: 1 }),
    // Um chat que não existe: o Telegram responde "chat not found".
    unreachable: createTelegramBot({ token, chat: "-1", pollSeconds: 1 }),
    secret: token,
  }));
} else {
  describe.skip("Contrato ManagementInterface: Telegram (Bot API real - opt-in)", () => {
    // Pulado na CI e por padrão. Para rodar contra um bot e um chat de teste, veja CONTRIBUTING.md:
    // TEST_TELEGRAM_BOT_TOKEN=... TEST_TELEGRAM_CHAT_ID=... npx vitest run test/management-telegram.contract.test.ts
  });
}
