import { setTimeout as sleep } from "node:timers/promises";
import { createDbFromEnv, pingDatabase, processOutbox } from "@rabaed/db";
import { z } from "zod";
import { createLogger } from "./log.ts";

// The outbox processor: each poll delivers the due outbox rows (in-app
// notifications). The api reports the backlog for the outbox alarms, so they
// see a stopped worker (apps/api/src/outbox-report.ts). It connects as the app
// role with no Member set, which the outbox functions require.
const env = z
  .object({ WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000) })
  .parse(process.env);

const log = createLogger();
const db = createDbFromEnv("app", { max: 2 });
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

let lastOk: boolean | undefined;
log.info("worker started");
while (!stop.signal.aborted) {
  const ok = await pingDatabase(db);
  if (ok !== lastOk) {
    if (ok) log.info("database ok");
    else log.warn("database unavailable");
  }
  lastOk = ok;
  if (ok) {
    try {
      // Counts only: never a row's payload.
      const run = await processOutbox(db);
      if (run.processed || run.failed || run.dead) log.info({ run }, "outbox run");
    } catch (error) {
      // Through the err serializer: a database error by its code only.
      log.error({ err: error instanceof Error ? error : new Error(String(error)) }, "outbox run failed");
    }
  }
  await sleep(env.WORKER_POLL_INTERVAL_MS, undefined, { signal: stop.signal }).catch(() => undefined);
}
await db.destroy();
log.info("worker stopped");
