import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createFactoryModels } from "../src/factory-models.js";

it("reconhece a assinatura Codex salva entre reinícios, sem exigir chave de API", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fabrica-auth-"));
  try {
    const authPath = join(dir, "auth.json");
    await writeFile(
      authPath,
      JSON.stringify({
        "openai-codex": { type: "oauth", access: "token-falso", refresh: "refresh-falso", expires: 4102444800000 },
      }),
      { mode: 0o600 },
    );
    const models = await createFactoryModels({ authPath });
    expect(models.isUsingSubscription("openai-codex")).toBe(true);
    expect(models.getModel("openai-codex", "gpt-6.1-terra")).toBeDefined();
    const restarted = await createFactoryModels({ authPath });
    expect(restarted.isUsingSubscription("openai-codex")).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
