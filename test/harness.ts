import type { ProjectConfig } from "../src/config.js";
import type { Card } from "../src/demand-source.js";
import { type RunningFactory, startFactory } from "../src/factory.js";
import { MemoryDemandSource } from "./fakes/memory-demand-source.js";

export const USER = "igor";

export function testProjectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "exemplo",
    source: { type: "jira", project: "PROJ", assignee: USER },
    statuses: {
      Backlog: "backlog",
      "A Fazer": "todo",
      "Em Andamento": "in_progress",
      "Aguardando Teste": "waiting_test",
      "Aguardando Validação": "waiting_validation",
      GMUD: "gmud",
      Concluído: "done",
    },
    ...overrides,
  };
}

export interface TestFactory extends RunningFactory {
  source: MemoryDemandSource;
}

/** A fábrica inteira, com todas as portas trocadas por fakes em memória. */
export async function startTestFactory(opts: { cards?: Card[] } = {}): Promise<TestFactory> {
  const source = new MemoryDemandSource(opts.cards);
  const factory = await startFactory({ projects: [{ config: testProjectConfig(), source }] });
  return { ...factory, source };
}
