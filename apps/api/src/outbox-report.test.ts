import type { OutboxStats } from "@rabaed/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startOutboxReport } from "./outbox-report.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function logger() {
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  return {
    lines,
    info: (obj: Record<string, unknown>, msg: string) => lines.push({ level: "info", obj, msg }),
    warn: (obj: Record<string, unknown>, msg: string) => lines.push({ level: "warn", obj, msg }),
  };
}

describe("the api's outbox report", () => {
  it("logs the outbox's backlog and oldest age, read from the database, at once and then every interval", async () => {
    const log = logger();
    let stats: OutboxStats = { backlog: 0, oldestAgeSeconds: 0 };
    const stop = startOutboxReport({ stats: async () => stats, log, intervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    stats = { backlog: 3, oldestAgeSeconds: 420 };
    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(log.lines).toEqual([
      { level: "info", obj: { outbox: { backlog: 0, oldestAgeSeconds: 0 } }, msg: "outbox" },
      { level: "info", obj: { outbox: { backlog: 3, oldestAgeSeconds: 420 } }, msg: "outbox" },
    ]);
  });

  it("logs no outbox line when the database can't be read, so the alarms see missing data", async () => {
    const log = logger();
    const failure = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" });
    const stop = startOutboxReport({ stats: () => Promise.reject(failure), log, intervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(log.lines).toEqual([{ level: "warn", obj: { err: failure }, msg: "outbox report failed" }]);
  });
});
