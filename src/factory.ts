import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { CardState, ProjectConfig } from "./config.js";
import type { DemandSource } from "./demand-source.js";

export interface FactoryProject {
  config: ProjectConfig;
  source: DemandSource;
}

export interface QueueItem {
  project: string;
  key: string;
  title: string;
  status: string;
  state: CardState;
}

export interface RunningFactory {
  url: string;
  close(): Promise<void>;
}

/** Estados em que a fábrica assume um card. */
const ELIGIBLE: ReadonlySet<CardState> = new Set(["todo", "in_progress"]);

async function queue(projects: FactoryProject[]): Promise<QueueItem[]> {
  const items: QueueItem[] = [];
  for (const { config, source } of projects) {
    for (const card of await source.listAssignedCards(config.source.assignee)) {
      const state = config.statuses[card.status];
      if (card.assignee !== config.source.assignee || !state || !ELIGIBLE.has(state)) continue;
      items.push({ project: config.name, key: card.key, title: card.title, status: card.status, state });
    }
  }
  return items;
}

/** Sobe a API local da fábrica, sempre só em localhost. `port: 0` escolhe uma porta livre. */
export async function startFactory(opts: { projects: FactoryProject[]; port?: number }): Promise<RunningFactory> {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/queue") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(await queue(opts.projects)));
        return;
      }
      res.writeHead(404).end();
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
