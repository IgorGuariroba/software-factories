import { createGhRetroSink } from "../src/retro-sink.js";
import { FakeGh } from "./fakes/fake-gh.js";
import { describeRetroSinkContract } from "./retro-sink.contract.js";

// O adaptador `gh` contra um `gh` falso nos formatos do GitHub (lista em JSON, URL impressa na criação).
describeRetroSinkContract("GhRetroSink (gh falso)", () => {
  const gh = new FakeGh();
  const repo = "fabrica/fabrica-teste";
  return {
    sink: createGhRetroSink({ runner: gh.runner }),
    repo,
    seedHidden: async (title, kind) => {
      gh.store.seed(repo, kind === "fechada" ? { title, state: "closed" } : { title, labels: ["bug"] });
    },
  };
});
