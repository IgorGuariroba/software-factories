import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createCodingTools } from "@earendil-works/pi-durable/tools";

// Catálogo com os 5 planos ativos no seu ambiente
export const FACTORY_PLANS = {
  // 1. OpenAI ChatGPT Pro / Codex
  codex: {
    name: "OpenAI Codex (ChatGPT Pro)",
    provider: "openai-codex",
    modelId: "gpt-6-astra",
  },
  // 2. Claude Code Subscription (OAuth)
  claude: {
    name: "Claude Code Subscription",
    provider: "claude-subscription",
    modelId: "claude-haiku-4-5",
  },
  // 3. Antigravity (Google Gemini Quota)
  antigravity: {
    name: "Google Antigravity",
    provider: "antigravity",
    modelId: "gemini-3.8-flash",
  },
  // 4. Cursor Subscription
  cursor: {
    name: "Cursor Subscription",
    provider: "cursor",
    modelId: "auto",
  },
  // 5. OpenRouter
  openrouter: {
    name: "OpenRouter",
    provider: "openrouter",
    modelId: "~anthropic/claude-haiku-latest",
  },
} as const;

type PlanKey = keyof typeof FACTORY_PLANS;

async function main() {
  console.log("==================================================");
  console.log("   Fábrica de Software - Runtime Multi-Planos");
  console.log("==================================================\n");

  // 1. Inicializa os serviços oficiais do Pi (carrega auth.json, extensões e tokens automaticamente)
  const services = await createAgentSessionServices({ cwd: process.cwd() });
  const models = services.modelRuntime; // ModelRuntime implementa Models

  console.log("Carregando provedores autenticados:");
  for (const [key, plan] of Object.entries(FACTORY_PLANS)) {
    const isAvailable = !!models.getProvider(plan.provider);
    console.log(
      `  • [${key.padEnd(11)}] ${plan.name} (${plan.provider} / ${plan.modelId}) => ${isAvailable ? "OK" : "Indisponível"}`,
    );
  }
  console.log("");

  // 2. Determina qual plano testar (via argumento CLI ex: 'npm start antigravity' ou padrão 'antigravity')
  const requestedArg = process.argv[2] as PlanKey | undefined;
  const activeKey: PlanKey = requestedArg && requestedArg in FACTORY_PLANS ? requestedArg : "antigravity";
  const selectedPlan = FACTORY_PLANS[activeKey];

  console.log(
    `Plano ativo para este turno: [${activeKey.toUpperCase()}] -> ${selectedPlan.provider} / ${selectedPlan.modelId}`,
  );

  // 3. Registra ferramentas de código (bash, read, edit, write)
  const registry = createRegistry();
  const images = await createNodePhotonImages();
  registry.install(createCodingTools({ images }));

  // 4. Abre o storage durável SQLite
  const storagePath = "./factory-session.sqlite";
  const storage = await openNodeSqliteStorage(storagePath);

  // 5. Orquestra o Harness durável conectado ao catálogo multi-planos
  const harness = await Harness.open(
    storage,
    {
      models,
      registry,
      env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? process.cwd() }),
    },
    BACKGROUND_CONTEXT,
  );

  await harness.resume();
  const root = await harness.root(BACKGROUND_CONTEXT);

  // 6. Configura o modelo escolhido na sessão
  await root.configure(
    {
      model: {
        provider: selectedPlan.provider,
        modelId: selectedPlan.modelId,
      },
      instructions: "Você é um assistente técnico conciso da fábrica de software.",
    },
    BACKGROUND_CONTEXT,
  );

  // 7. Envia a tarefa de teste
  console.log(`Enviando prompt durável via ${selectedPlan.name}...`);
  const submission = await root.submit(
    {
      type: "input",
      content: [
        {
          type: "text",
          text: `Diga apenas: 'Plano ${selectedPlan.name} funcionando 100% na fábrica durável!'`,
        },
      ],
    },
    BACKGROUND_CONTEXT,
  );

  const settled = await submission.wait(BACKGROUND_CONTEXT);
  console.log(`Status da execução: ${settled.status}`);

  // 8. Lê a resposta persistida no banco SQLite
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

  await storage.close(BACKGROUND_CONTEXT);
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro na fábrica:", err);
  process.exit(1);
});
