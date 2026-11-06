import type { LinkedPullRequest } from "../../src/demand-source.js";
import { MemoryDemandSource } from "./memory-demand-source.js";

/** Fonte em memória com o que só o GitHub tem: PRs que citam a issue e a baixa com motivo. */
export class MemoryGitHubSource extends MemoryDemandSource {
  pullRequests = new Map<string, LinkedPullRequest[]>();
  /** Baixas dadas, na ordem. */
  dismissed: { key: string; reason: string }[] = [];

  async linkedPullRequests(key: string): Promise<LinkedPullRequest[]> {
    return [...(this.pullRequests.get(key) ?? [])];
  }

  async dismiss(key: string, reason: "completed" | "not_planned" | "duplicate"): Promise<void> {
    const card = this.cards.find((c) => c.key === key);
    if (!card) throw new Error(`Card ${key} não existe`);
    card.status = "fechada";
    this.dismissed.push({ key, reason });
  }
}
