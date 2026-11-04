import type { OutboxStats } from "@rabaed/db";

// The outbox alarms (packages/infra/src/monitoring-stack.ts) read this line
// from the api's log, not the worker's: measured in the database, it keeps
// arriving when the worker has stopped, and the age it reports keeps growing
// (RP-245). Keep the field names. When the api is down or cannot read the
// database, the line stops, which the alarms treat as breaching.

export interface OutboxReportOptions {
  stats: () => Promise<OutboxStats>;
  log: {
    info(obj: Record<string, unknown>, msg: string): void;
    warn(obj: Record<string, unknown>, msg: string): void;
  };
  intervalMs: number;
}

/** Logs the outbox's backlog and oldest age at once, then every `intervalMs`; returns a function that stops it. */
export function startOutboxReport({ stats, log, intervalMs }: OutboxReportOptions): () => void {
  const report = async () => {
    try {
      const { backlog, oldestAgeSeconds } = await stats();
      log.info({ outbox: { backlog, oldestAgeSeconds } }, "outbox");
    } catch (error) {
      // Through the err serializer: a database error by its code only (apps/api/src/logging.ts).
      log.warn({ err: error }, "outbox report failed");
    }
  };
  const first = setTimeout(report, 0);
  const every = setInterval(report, intervalMs);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
