import { describe, expect, it, vi } from "vitest";
import { type EfeitoWebhook, executarEfeitosWebhook } from "../src/packages/sincronizacao-github/index.js";
import { interfaceSalvaVigente, reiniciaAposSalvar } from "../src/packages/telegram-config/index.js";

// Regras que saíram da fábrica: a interface do Telegram salva só vale com credencial, criação possível e token no cofre;
// reiniciar depois de salvar só quando a configuração salva manda; e o efeito de abortar só alcança execução que existe.

const salva = { chat: "-100", usuario: "42", credential: "bot" };

describe("Telegram: interface salva vigente", () => {
  it("com credencial, criação possível e token no cofre, vale com chat e usuário", async () => {
    expect(
      await interfaceSalvaVigente({
        guardada: async () => salva,
        podeCriarInterface: true,
        tokenDe: async () => "TOKEN",
      }),
    ).toEqual({ token: "TOKEN", chat: "-100", usuario: "42" });
  });

  it("sem configuração salva, ou sem credencial, não vale", async () => {
    const tokenDe = vi.fn(async () => "TOKEN");
    expect(
      await interfaceSalvaVigente({ guardada: async () => undefined, podeCriarInterface: true, tokenDe }),
    ).toBeUndefined();
    expect(
      await interfaceSalvaVigente({
        guardada: async () => ({ chat: "-1", usuario: "2" }),
        podeCriarInterface: true,
        tokenDe,
      }),
    ).toBeUndefined();
    expect(tokenDe).not.toHaveBeenCalled();
  });

  it("sem capacidade de criar a interface, não lê o token nem vale", async () => {
    const tokenDe = vi.fn(async () => "TOKEN");
    expect(
      await interfaceSalvaVigente({ guardada: async () => salva, podeCriarInterface: false, tokenDe }),
    ).toBeUndefined();
    expect(tokenDe).not.toHaveBeenCalled();
  });

  it("token ausente no cofre: não vale", async () => {
    expect(
      await interfaceSalvaVigente({
        guardada: async () => salva,
        podeCriarInterface: true,
        tokenDe: async () => undefined,
      }),
    ).toBeUndefined();
  });
});

describe("Telegram: reinício depois de salvar", () => {
  it("só reinicia quando não há variável de ambiente", () => {
    expect(reiniciaAposSalvar(false)).toBe(true);
    expect(reiniciaAposSalvar(true)).toBe(false);
  });
});

describe("Webhook: efeitos", () => {
  type Motivo = "outro";
  const efeitos: EfeitoWebhook<Motivo>[] = [
    { type: "abortar", id: "p/K-1" },
    { type: "abortar", id: "p/K-2" },
    { type: "notificar", project: "p", target: "K-3", reason: "outro", message: "aviso" },
  ];

  it("aborta só a execução que existe, e notifica o resto em ordem", async () => {
    const abortados: number[] = [];
    const notificados: string[] = [];
    await executarEfeitosWebhook<Motivo>(
      {
        execucaoDe: async (id) => (id === "p/K-1" ? 7 : null),
        abortar: async (id) => {
          abortados.push(id);
        },
        notificar: async (e) => {
          notificados.push(e.message);
        },
      },
      efeitos,
    );
    expect(abortados).toEqual([7]);
    expect(notificados).toEqual(["aviso"]);
  });

  it("Tarefa sem execução (undefined) também não é abortada", async () => {
    const abortar = vi.fn(async () => undefined);
    await executarEfeitosWebhook<Motivo>(
      { execucaoDe: async () => undefined, abortar, notificar: async () => undefined },
      [{ type: "abortar", id: "p/X-1" }],
    );
    expect(abortar).not.toHaveBeenCalled();
  });
});
