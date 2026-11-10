import { afterEach, describe, expect, it } from "vitest";
import { FakeTelegram } from "./fakes/fake-telegram.js";
import { api, startTestFactory, type TestFactory } from "./harness.js";

// Fatia 09: bot e chat do Telegram são do usuário, configurados uma vez para todos os projetos.
describe("Telegram global ao usuário (fatia 09)", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("grava chat e credencial do bot, e devolve a configuração sem o token", async () => {
    f = await startTestFactory({});
    await api(f, "PUT", "/segredos/telegram-bot", { valor: "123456:TOKEN-SECRETO-abcdefghijklmnopqrstuvwxyz" });

    await api(f, "PUT", "/telegram/configuracao", { chat: "987654", credential: "telegram-bot", usuario: "111" });
    const lido = await api<{ chat: string; credential: string }>(f, "GET", "/telegram/configuracao");

    expect(lido).toMatchObject({ chat: "987654", credential: "telegram-bot" });
    expect(JSON.stringify(lido)).not.toContain("TOKEN-SECRETO");
  });

  it("recusa uma credencial do bot que não está no cofre", async () => {
    f = await startTestFactory({});

    const res = await fetch(`${f.url}/telegram/configuracao`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat: "987654", credential: "telegram-bot", usuario: "111" }),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("credencial telegram-bot não cadastrada");
  });

  it("sem configuração, a leitura responde 404", async () => {
    f = await startTestFactory({});

    const res = await fetch(`${f.url}/telegram/configuracao`);

    expect(res.status).toBe(404);
  });
});

describe("Telegram salvo pela interface é ligado no startup, com o token do cofre", () => {
  let f: TestFactory | undefined;
  afterEach(async () => {
    await f?.close();
    f = undefined;
  });

  it("ao reiniciar, a interface de gestão é criada com o token do cofre e o chat e o usuário salvos", async () => {
    const criados: { token: string; chat: string }[] = [];
    f = await startTestFactory({
      criarInterfaceTelegram: (token, chat) => {
        criados.push({ token, chat });
        return new FakeTelegram();
      },
    });
    await api(f, "PUT", "/segredos/telegram-bot", { valor: "123456:TOKEN-DO-COFRE" });
    await api(f, "PUT", "/telegram/configuracao", { chat: "987654", credential: "telegram-bot", usuario: "111" });
    expect(criados).toEqual([]);

    f = await f.restartComYaml({});

    expect(criados).toEqual([{ token: "123456:TOKEN-DO-COFRE", chat: "987654" }]);
  });

  it("sem usuário autorizado, a configuração do Telegram é recusada", async () => {
    f = await startTestFactory({});
    await api(f, "PUT", "/segredos/telegram-bot", { valor: "123456:T" });

    const res = await fetch(`${f.url}/telegram/configuracao`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat: "987654", credential: "telegram-bot" }),
    });

    expect(res.status).toBe(400);
  });
});
