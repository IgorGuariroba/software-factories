import { describe, expect, it, vi } from "vitest";
import {
  type ConfiguracaoTelegram,
  criarConfiguracaoTelegram,
  type PortasTelegram,
} from "../src/packages/telegram-config/index.js";

// Configuração do Telegram com portas falsas: fixa o formato do chat e do usuário, a credencial que precisa estar
// cadastrada, o que é gravado e o reinício da interface depois de salvar.

function portasFalsas(guardada?: ConfiguracaoTelegram, cadastradas: string[] = []) {
  const gravadas: ConfiguracaoTelegram[] = [];
  const reiniciar = vi.fn(async () => undefined);
  const portas: PortasTelegram = {
    guardada: async () => guardada,
    gravar: async (c) => {
      gravadas.push(c);
    },
    credencialCadastrada: async (nome) => cadastradas.includes(nome),
    reiniciar,
  };
  return { telegram: criarConfiguracaoTelegram(portas), gravadas, reiniciar };
}

const valido = { chat: "-1001", usuario: "42" };

describe("Telegram: configuração", () => {
  it("sem configuração guardada, responde 404", async () => {
    const { telegram } = portasFalsas();
    expect(await telegram.obter()).toEqual({ status: 404, body: { error: "Telegram não configurado" } });
  });

  it("com configuração guardada, devolve a configuração", async () => {
    const c = { chat: "-1", usuario: "2" };
    const { telegram } = portasFalsas(c);
    expect(await telegram.obter()).toEqual({ status: 200, body: c });
  });

  it("chat que não é numérico responde 400 e não grava", async () => {
    const { telegram, gravadas } = portasFalsas();
    expect((await telegram.salvar({ ...valido, chat: "abc" })).status).toBe(400);
    expect(gravadas).toEqual([]);
  });

  it("usuário que não é numérico responde 400", async () => {
    const { telegram } = portasFalsas();
    const r = await telegram.salvar({ ...valido, usuario: "@ana" });
    expect(r).toMatchObject({ status: 400, body: { error: expect.stringContaining("usuario") } });
  });

  it("credencial não cadastrada responde 400", async () => {
    const { telegram, gravadas } = portasFalsas(undefined, []);
    expect(await telegram.salvar({ ...valido, credential: "bot" })).toEqual({
      status: 400,
      body: { error: "credencial bot não cadastrada" },
    });
    expect(gravadas).toEqual([]);
  });

  it("salvar grava com os valores aparados, reinicia a interface e devolve o que gravou", async () => {
    const { telegram, gravadas, reiniciar } = portasFalsas(undefined, ["bot"]);
    const r = await telegram.salvar({ chat: " -1001 ", usuario: " 42 ", credential: " bot " });
    expect(r).toEqual({ status: 200, body: { chat: "-1001", usuario: "42", credential: "bot" } });
    expect(gravadas).toEqual([{ chat: "-1001", usuario: "42", credential: "bot" }]);
    expect(reiniciar).toHaveBeenCalledTimes(1);
  });

  it("sem credencial, não grava o campo credential", async () => {
    const { telegram, gravadas } = portasFalsas();
    await telegram.salvar(valido);
    expect(gravadas[0]).toEqual({ chat: "-1001", usuario: "42" });
  });
});
