import { MemoryRetroSink } from "./fakes/memory-retro-sink.js";
import { describeRetroSinkContract } from "./retro-sink.contract.js";

describeRetroSinkContract("MemoryRetroSink", () => {
  const sink = new MemoryRetroSink();
  const repo = "fabrica/fabrica-teste";
  return {
    sink,
    repo,
    seedHidden: async (title, kind) => {
      sink.seed(repo, kind === "fechada" ? { title, state: "closed" } : { title, labels: ["bug"] });
    },
  };
});
