import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGitHubSignature } from "../src/github-webhook.js";

const SECRET = "segredo-de-teste-do-app";

/** Assinatura como o GitHub a envia: `sha256=` + HMAC-SHA256 do corpo cru, em hex. */
const sign = (body: Buffer, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyGitHubSignature", () => {
  it("aceita a assinatura calculada sobre o corpo cru", () => {
    const body = Buffer.from('{"action":"opened","issue":{"number":12}}');
    expect(verifyGitHubSignature({ secret: SECRET, body, signature: sign(body) })).toBe(true);
  });

  it("assina bytes que não são UTF-8 válido: a verificação usa o corpo cru, não texto", () => {
    const body = Buffer.from([0xff, 0xfe, 0x00, 0x7b, 0x80]);
    expect(verifyGitHubSignature({ secret: SECRET, body, signature: sign(body) })).toBe(true);
  });

  it("recusa quando o corpo foi alterado depois de assinado", () => {
    const signed = Buffer.from('{"action":"opened"}');
    const tampered = Buffer.from('{"action":"deleted"}');
    expect(verifyGitHubSignature({ secret: SECRET, body: tampered, signature: sign(signed) })).toBe(false);
  });

  it("recusa assinatura feita com outro secret", () => {
    const body = Buffer.from('{"action":"opened"}');
    expect(verifyGitHubSignature({ secret: SECRET, body, signature: sign(body, "outro-secret") })).toBe(false);
  });

  it("recusa sem o cabeçalho", () => {
    const body = Buffer.from("{}");
    expect(verifyGitHubSignature({ secret: SECRET, body, signature: undefined })).toBe(false);
    expect(verifyGitHubSignature({ secret: SECRET, body, signature: "" })).toBe(false);
  });

  it("recusa o prefixo antigo sha1= mesmo com o digest certo", () => {
    const body = Buffer.from("{}");
    const hex = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(verifyGitHubSignature({ secret: SECRET, body, signature: `sha1=${hex}` })).toBe(false);
  });

  it("recusa assinatura malformada ou de tamanho diferente, sem lançar erro", () => {
    const body = Buffer.from("{}");
    expect(verifyGitHubSignature({ secret: SECRET, body, signature: "sha256=abc" })).toBe(false);
    expect(verifyGitHubSignature({ secret: SECRET, body, signature: "sha256=zz".padEnd(71, "z") })).toBe(false);
    expect(verifyGitHubSignature({ secret: SECRET, body, signature: "sha256=" })).toBe(false);
  });

  it("falha fechado quando o secret não está configurado", () => {
    const body = Buffer.from("{}");
    expect(verifyGitHubSignature({ secret: "", body, signature: sign(body, "") })).toBe(false);
  });
});

describe("verifyGitHubSignature: corpo como texto não é aceito como substituto dos bytes", () => {
  it("uma assinatura do corpo com espaço a mais é diferente", () => {
    const body = Buffer.from('{"a":1}');
    expect(verifyGitHubSignature({ secret: SECRET, body: Buffer.from('{"a":1} '), signature: sign(body) })).toBe(false);
  });
});
