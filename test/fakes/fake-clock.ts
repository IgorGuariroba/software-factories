import type { SetTimer } from "@earendil-works/pi-durable";
import type { FactoryClock } from "../../src/factory.js";

/**
 * Relógio falso da fábrica (e do motor durável): o tempo só anda quando o teste chama `advanceTo`/`advance`, e os
 * timers vencidos disparam nesse momento. Timers sem atraso disparam já, para o motor não travar.
 */
export class FakeClock implements FactoryClock {
  private current: number;
  private timers = new Set<{ at: number; callback: () => void }>();

  constructor(start: string | Date) {
    this.current = new Date(start).getTime();
  }

  now = (): number => this.current;

  setTimer: SetTimer = (callback, delayMs, { background }) => {
    // Timers que só liberam memória podem ser recusados (ver `HarnessOptions.setTimer`).
    if (background) return undefined;
    if (delayMs <= 0) {
      const immediate = setImmediate(callback);
      return () => clearImmediate(immediate);
    }
    const timer = { at: this.current + delayMs, callback };
    this.timers.add(timer);
    return () => this.timers.delete(timer);
  };

  /** Avança o relógio até `to` e dispara, em ordem, os timers vencidos. */
  advanceTo(to: string | Date): void {
    const target = new Date(to).getTime();
    if (target < this.current) throw new Error("o relógio falso não volta no tempo");
    this.current = target;
    const due = [...this.timers].filter((t) => t.at <= target).sort((a, b) => a.at - b.at);
    for (const timer of due) {
      this.timers.delete(timer);
      timer.callback();
    }
  }
}
