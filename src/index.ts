import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import {
  createRegistry,
  Harness
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createCodingTools } from "@earendil-works/pi-durable/tools";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// CredentialStore unificado: lê credenciais tanto do Codex (~/.pi/agent/auth.json)
// quanto do Claude Code (~/.claude/.credentials.json)
class UnifiedSubscriptionCredentialStore {
  private piAuthPath = path.join(os.homedir(), ".pi/agent/auth.json");
  private claudeCredPath = path.join(os.homedir(), ".claude/.credentials.json");

  async read(providerId: string) {
    // 1. Provedor Anthropic / Claude Code
    if (providerId === "anthropic") {
      if (fs.existsSync(this.claudeCredPath)) {
        try {
          const creds = JSON.parse(fs.readFileSync(this.claudeCredPath, "utf8"));
          const token = creds.claudeAiOauth?.accessToken;
          if (token) {
            return { type: "api_key", key: token };
          }
        } catch {}
      }
    }

    // 2. Provedor OpenAI Codex e outros registrados no Pi
    if (fs.existsSync(this.piAuthPath)) {
      try {
        const all = JSON.parse(fs.readFileSync(this.piAuthPath, "utf8"));
        if (all[providerId]) return all[providerId];
      } catch {}
    }

    return undefined;
  }

  async list() {
    const list: Array<{ providerId: string; type: "api_key" | "oauth" }> = [];
    if (fs.existsSync(this.claudeCredPath)) {
      list.push({ providerId: "anthropic", type: "api_key" });
    }
    if (fs.existsSync(this.piAuthPath)) {
      try {
        const all = JSON.parse(fs.readFileSync(this.piAuthPath, "utf8"));
        for (const [providerId, c] of Object.entries(all) as [string, any][]) {
          list.push({ providerId, type: c.type });
        }
      } catch {}
    }
    return list;
  }

  async modify(providerId: string, fn: (current: any) => Promise<any>) {
    if (fs.existsSync(this.piAuthPath)) {
      const all = JSON.parse(fs.readFileSync(this.piAuthPath, "utf8"));
      const updated = await fn(all[providerId]);
      if (updated === undefined) {
        delete all[providerId];
      } else {
        all[providerId] = updated;
      }
      fs.writeFileSync(this.piAuthPath, JSON.stringify(all, null, 2));
      return updated;
    }
    return undefined;
  }

  async delete(providerId: string) {
    if (fs.existsSync(this.piAuthPath)) {
      const all = JSON.parse(fs.readFileSync(this.piAuthPath, "utf8"));
      delete all[providerId];
      fs.writeFileSync(this.piAuthPath, JSON.stringify(all, null, 2));
    }
  }
}

// Modelos configurados para a sua fábrica
export const FACTORY_MODELS = {
  // Plano Codex (ChatGPT Pro)
  codex: {
    provider: "openai-codex",
    modelId: "gpt-6-astra",
  },
  // Plano Claude Code Subscription
  claudeFast: {
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
  },
  claudeReasoning: {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
  },
} as const;

async function main() {
  console.log("==================================================");
  console.log("   Fábrica de Software - Runtime Durável Multi-Plano");
  console.log("==================================================\n");

  // 1. Inicializa o catálogo com os dois provedores
  const credentials = new UnifiedSubscriptionCredentialStore();
  const models = createModels({ credentials });

  const codex = openaiCodexProvider();
  const claude = anthropicProvider();

  models.setProvider(codex);
  models.setProvider(claude);

  console.log("Provedores configurados:");
  console.log("  • OpenAI Codex (ChatGPT Pro): gpt-6-astra, gpt-6.1-sol, etc.");
  console.log("  • Anthropic (Claude Code):    claude-haiku-4-5, claude-sonnet-4-6, etc.\n");

  // 2. Registro de ferramentas de código
  const registry = createRegistry();
  const images = await createNodePhotonImages();
  registry.install(createCodingTools({ images }));

  // 3. Storage durável SQLite
  const storagePath = "./factory-session.sqlite";
  const storage = await openNodeSqliteStorage(storagePath);

  const harness = await Harness.open(
    storage,
    {
      models,
      registry,
      env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? process.cwd() }),
    },
    BACKGROUND_CONTEXT
  );

  await harness.resume();
  const root = await harness.root(BACKGROUND_CONTEXT);

  // 4. Exemplo de uso: escolher qual plano usar para o turno
  // Alterne entre FACTORY_MODELS.claudeFast, FACTORY_MODELS.claudeReasoning ou FACTORY_MODELS.codex
  const targetModel = FACTORY_MODELS.claudeFast;

  console.log(`Configurando agente com: ${targetModel.provider} / ${targetModel.modelId}...`);
  await root.configure(
    {
      model: targetModel,
      instructions: "Você é um assistente conciso e técnico da fábrica de software.",
    },
    BACKGROUND_CONTEXT
  );

  console.log("Enviando tarefa de teste durável...");
  const submission = await root.submit(
    {
      type: "input",
      content: [
        {
          type: "text",
          text: "Diga apenas: 'Claude Code conectado com sucesso na fábrica durável!'",
        },
      ],
    },
    BACKGROUND_CONTEXT
  );

  const settled = await submission.wait(BACKGROUND_CONTEXT);
  console.log(`Status da execução: ${settled.status}`);

  // 5. Exibe a resposta mais recente registrada no histórico durável
  const page = await root.entries({ order: "ascending" }, 50, undefined, BACKGROUND_CONTEXT);
  const assistantEntries = page.items.filter((e: any) => e.kind === "pi.assistant");
  const lastReply = assistantEntries[assistantEntries.length - 1];

  if (lastReply && (lastReply as any).model?.[0]?.content) {
    const modelInfo = (lastReply as any).model[0];
    const textParts = modelInfo.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    console.log(`\n--- Resposta de [${modelInfo.provider} / ${modelInfo.model}] ---`);
    console.log(textParts);
    console.log("----------------------------------------------------------------\n");
  }

  await storage.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro na fábrica:", err);
  process.exit(1);
});
