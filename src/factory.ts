import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { CardState, ProjectConfig } from "./config.js";
import type { DemandSource } from "./demand-source.js";
import { createEffectWriter, type EffectWriter, GuardrailViolation } from "./effect-writer.js";
import { EventLog } from "./events.js";

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

/** Estado mais avançado para onde a fábrica move cards no M1. */
const TRANSITION_LIMIT: CardState = "in_progress";

/** Sobe a API local da fábrica, sempre só em localhost. `port: 0` escolhe uma porta livre. */
export async function startFactory(opts: {
  projects: FactoryProject[];
  port?: number;
  /** Intervalo entre buscas automáticas na Fonte. Sem ele, a fábrica só busca via `POST /poll`. */
  pollIntervalMs?: number;
}): Promise<RunningFactory> {
  const events = new EventLog();
  const projects = opts.projects.map((p) => ({
    ...p,
    writer: createEffectWriter({ ...p, events, transitionLimit: TRANSITION_LIMIT }) satisfies EffectWriter,
  }));
  /** Cards já assumidos e cards que já receberam o comentário de assunção. Persistência durável chega na M1-04. */
  const assumed = new Set<string>();
  const commented = new Set<string>();

  async function queue(): Promise<QueueItem[]> {
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

  /** Busca na Fonte e assume os cards "A Fazer" ainda não assumidos. */
  async function poll(): Promise<void> {
    const failures: unknown[] = [];
    for (const item of await queue()) {
      const id = `${item.project}/${item.key}`;
      if (item.state !== "todo" || assumed.has(id)) continue;
      const project = projects.find((p) => p.config.name === item.project);
      if (!project) continue;
      try {
        // Cada passo é registrado ao concluir, para que uma nova tentativa não repita o que já foi feito.
        if (!commented.has(id)) {
          await project.writer.comment(item.key, "Assumindo este card.");
          commented.add(id);
        }
        await project.writer.transition(item.key, "in_progress");
        assumed.add(id);
      } catch (err) {
        // Bloqueio de guardrail já fica registrado como evento; outros erros não impedem os demais cards.
        if (!(err instanceof GuardrailViolation)) failures.push(err);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `${failures.length} cards falharam ao ser assumidos`);
  }

  const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(payload);
  };

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/queue") return json(res, 200, await queue());
      if (req.method === "GET" && req.url === "/events") return json(res, 200, events.list());
      if (req.method === "POST" && req.url === "/poll") {
        await serializedPoll();
        return json(res, 200, { ok: true });
      }
      res.writeHead(404).end();
    } catch (err) {
      json(res, 500, { error: String(err) });
    }
  });

  /** Uma busca por vez, venha ela do timer ou da API, para nunca assumir o mesmo card em dobro. */
  let polling: Promise<void> = Promise.resolve();
  function serializedPoll(): Promise<void> {
    const run = polling.then(poll);
    polling = run.catch(() => undefined);
    return run;
  }
  const timer =
    opts.pollIntervalMs &&
    setInterval(() => {
      serializedPoll().catch((err) => console.error("[fábrica] erro na busca:", err));
    }, opts.pollIntervalMs);

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      if (timer) clearInterval(timer);
      await polling;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
