import { describe } from "vitest";
import { createGhRetroSink } from "../src/retro-sink.js";
import { describeRetroSinkContract } from "./retro-sink.contract.js";

const repo = process.env.TEST_RETRO_REPO;

if (repo) {
  // Escreve de verdade: issues com a label `retro` num repositório de teste seu, nunca no da fábrica.
  describeRetroSinkContract("GhRetroSink (real - opt-in)", () => ({ sink: createGhRetroSink(), repo }));
} else {
  describe.skip("Contrato RetroSink: GhRetroSink (real - opt-in)", () => {
    // Pulado na CI e por padrão. Para rodar fora da CI contra um repositório de teste (com a label `retro`):
    // TEST_RETRO_REPO=seu-usuario/sandbox-retro npx vitest run test/retro-sink-gh.contract.test.ts
  });
}
