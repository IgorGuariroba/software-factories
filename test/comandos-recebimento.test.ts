import { describe, expect, it } from "vitest";
import {
  cursorDepois,
  deveZerarCursor,
  esperaAteZerarCursor,
  JANELA_DE_SILENCIO_MS,
  jaTratada,
} from "../src/packages/comandos-gestao/index.js";

// Recebimento de comandos: o cursor do Telegram zera depois de sete dias de silêncio (só no Telegram e com cursor avançado);
// a espera até zerar nunca é negativa; atualização antes do cursor não se trata de novo; o cursor avança para a seguinte.

const AGORA = 10_000_000_000;

describe("Recebimento: cursor", () => {
  it("zera depois de sete dias sem atualização, só no Telegram e com cursor avançado", () => {
    const antiga = AGORA - JANELA_DE_SILENCIO_MS;
    expect(deveZerarCursor({ via: "telegram", cursor: 5, ultimaAtualizacao: antiga, agora: AGORA })).toBe(true);
    expect(deveZerarCursor({ via: "telegram", cursor: 5, ultimaAtualizacao: AGORA - 1, agora: AGORA })).toBe(false);
    expect(deveZerarCursor({ via: "outro", cursor: 5, ultimaAtualizacao: antiga, agora: AGORA })).toBe(false);
    expect(deveZerarCursor({ via: "telegram", cursor: 0, ultimaAtualizacao: antiga, agora: AGORA })).toBe(false);
  });

  it("a espera até zerar nunca é negativa", () => {
    expect(esperaAteZerarCursor(AGORA - 1_000, AGORA)).toBe(JANELA_DE_SILENCIO_MS - 1_000);
    expect(esperaAteZerarCursor(AGORA - JANELA_DE_SILENCIO_MS * 2, AGORA)).toBe(0);
  });
});

describe("Recebimento: atualizações", () => {
  it("atualização antes do cursor já foi tratada; a da frente não", () => {
    expect(jaTratada(4, 5)).toBe(true);
    expect(jaTratada(5, 5)).toBe(false);
  });

  it("o cursor avança para a seguinte à tratada", () => {
    expect(cursorDepois(7)).toBe(8);
  });
});
